#!/usr/bin/env python3
"""从本地 USDA SR Legacy、Foundation 和台湾食药署压缩档生成离线候选库。

需 Python 3.9+ 与 Node.js。简体别名使用 macOS CoreFoundation、ICU uconv 或 OpenCC。
"""

from __future__ import annotations

import argparse
import csv
import ctypes
import hashlib
import io
import json
import re
import shutil
import subprocess
import sys
import tempfile
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from pathlib import Path
from zipfile import ZipFile


ROOT = Path(__file__).resolve().parents[1]
USDA_URL = "https://fdc.nal.usda.gov/food-details/{record_id}/nutrients"
TFDA_URL = "https://data.gov.tw/dataset/8543"
NUTRIENTS = {
    "valine": (1219, "Val"),
    "isoleucine": (1212, "Ile"),
    "methionine": (1215, "Met"),
    "threonine": (1211, "Thr"),
    "leucine": (1213, "Leu"),
    "lysine": (1214, "Lys"),
    "phenylalanine": (1217, "Phe"),
    "tryptophan": (1210, "Trp"),
    "histidine": (1221, "His"),
}
USDA_KEYS = {usda: key for key, (usda, _) in NUTRIENTS.items()} | {1003: "protein", 1004: "fat", 1051: "water"}
TFDA_KEYS = {tfda: key for key, (_, tfda) in NUTRIENTS.items()}
TFDA_COMPOSITION = {"粗蛋白": "protein", "粗脂肪": "fat", "水分": "water"}
STATE_PATTERNS = {
    "USDA": {
        "raw": r"\b(?:raw|uncooked)\b",
        "cooked": r"\b(?:cooked|boiled|steamed|roasted|fried|baked|grilled|broiled|poached|braised|stewed|sautéed|sauteed|toasted)\b",
        "dry": r"\b(?:dried|dehydrated|powder(?:ed)?|dry(?![- ](?:heat|roast|cur)))\b|^[^,;]*\bflour\b",
        "wet": r"\b(?:reconstituted|ready[- ]to[- ](?:feed|drink)|in syrup|prepared with (?:water|milk))\b",
        "processed": r"\b(?:canned|pickled|smoked|pasteurized|fermented|instant|puffed|powder(?:ed)?|concentrated)\b|^[^,;]*\bflour\b",
    },
    "TFDA": {
        "raw": r"(?:^|[,:;\s(])生(?=$|[,:;\s()])|生鮮",
        "cooked": r"(?:^|[,:;\s(])熟(?=$|[,:;\s()])|煮熟|煮沸|水煮|清蒸|蒸煮|油炸|烘烤|滷製|熟食|(?:^|\()(?:蒸|煮|烤|煎|炸|炒)(?=[,;()\d])",
        "dry": r"乾燥|乾貨|乾製|脫水|果乾|肉乾|魚乾|粉末|(?:粉|乾)(?=$|[(:;,])",
        "wet": r"液態|液狀|液體|復水|沖泡後|沖調後",
        "processed": r"罐頭|醃漬|醃製|煙燻|滅菌|發酵|加工品|(?:粉|加工)(?=$|[(:;,])",
    },
}


@dataclass
class Sample:
    name: str
    category: str
    aliases: list[str] = field(default_factory=list)
    english_names: list[str] = field(default_factory=list)
    description: str = ""
    values: dict[str, set[Decimal]] = field(default_factory=lambda: defaultdict(set))

    def add(self, key: str, value: str | int | Decimal | None, unit: str) -> None:
        if unit not in {"g", "mg"} or value is None:
            return
        try:
            amount = Decimal(str(value).strip())
        except InvalidOperation:
            return
        if amount.is_finite() and amount >= 0:
            self.values[key].add(amount * (1000 if unit == "g" else 1))


def zip_member(archive: ZipFile, basename: str) -> str:
    [member] = [name for name in archive.namelist() if Path(name).name == basename]
    return member


def archive_rows(archive: ZipFile, basename: str):
    with io.TextIOWrapper(archive.open(zip_member(archive, basename)), encoding="utf-8-sig", newline="") as content:
        yield from csv.DictReader(content)


def read_legacy(path: Path):
    with ZipFile(path) as archive:
        version = re.search(r"sr_legacy_food_csv_(\d{4}-\d{2})/", zip_member(archive, "food.csv"))[1]
        units = {int(row["id"]): row["unit_name"].lower() for row in archive_rows(archive, "nutrient.csv")}
        categories = {row["id"]: row["description"] for row in archive_rows(archive, "food_category.csv")}
        samples = {}
        for row in archive_rows(archive, "food.csv"):
            record_id = row["fdc_id"]
            if record_id in samples or row["data_type"] != "sr_legacy_food":
                raise ValueError(f"SR Legacy 食品编号重复或类型不符：{record_id}")
            samples[record_id] = Sample(row["description"], categories[row["food_category_id"]])
        for row in archive_rows(archive, "food_nutrient.csv"):
            nutrient_id = int(row["nutrient_id"])
            key = USDA_KEYS.get(nutrient_id)
            if key:
                samples[row["fdc_id"]].add(key, row["amount"], units[nutrient_id])
    return f"SR Legacy {version}", samples


def read_foundation(path: Path):
    with ZipFile(path) as archive:
        [member] = [name for name in archive.namelist() if name.endswith(".json")]
        version = re.search(r"foundation_food_json_(\d{4}-\d{2}-\d{2})\.json$", member)[1]
        with archive.open(member) as content:
            foods = json.load(content, parse_float=Decimal)["FoundationFoods"]
    samples = {}
    for food in foods:
        if food["isHistoricalReference"]:
            continue
        record_id = str(food["fdcId"])
        if record_id in samples or food["dataType"] != "Foundation":
            raise ValueError(f"Foundation 食品编号重复或类型不符：{record_id}")
        sample = samples[record_id] = Sample(food["description"], food["foodCategory"]["description"])
        for row in food["foodNutrients"]:
            nutrient = row["nutrient"]
            key = USDA_KEYS.get(nutrient["id"])
            if key:
                sample.add(key, row.get("amount"), nutrient["unitName"].lower())
    return f"Foundation {version}", samples


def split_aliases(value: str | None, separators: str) -> list[str]:
    normalized = unicodedata.normalize("NFKC", value or "")
    return re.split(rf"(?:{separators})(?![^()\[\]]*[)\]])", normalized)


def read_tfda(path: Path):
    with ZipFile(path) as archive:
        [member] = [entry for entry in archive.infolist() if entry.filename.endswith(".json")]
        year, month, day = member.date_time[:3]
        sha = hashlib.sha256(path.read_bytes()).hexdigest()[:12]
        version = f"{year:04}-{month:02}-{day:02}-{sha}"
        with archive.open(member) as content:
            foods = json.load(content)
    samples = {}
    for row in foods:
        record_id = row["整合編號"]
        if record_id not in samples:
            samples[record_id] = Sample(
                name=row["樣品名稱"],
                category=row["食品分類"],
                aliases=split_aliases(row["俗名"], r"[,;、]"),
                english_names=split_aliases(row["樣品英文名稱"], r"[;/、]|(?<=[a-zA-Z])\s*或\s*(?=[a-zA-Z])"),
                description=row["內容物描述"] or "",
            )
        sample = samples[record_id]
        if sample.name != row["樣品名稱"] or sample.category != row["食品分類"]:
            raise ValueError(f"台湾食药署样品编号对应多个名称或分类：{record_id}")
        label = row["分析項"]
        key = TFDA_COMPOSITION.get(label)
        if row["分析項分類"] == "胺基酸組成":
            key = TFDA_KEYS.get(label.rpartition("(")[2].rstrip(")"))
        if key and int(row["樣本數"] or 0) > 0:
            sample.add(key, row["每100克含量"], (row["含量單位"] or "").lower())
    return version, samples


def simplify_chinese(text: str) -> str:
    if sys.platform != "darwin":
        if uconv := shutil.which("uconv"):
            return subprocess.run([uconv, "-x", "Traditional-Simplified"], input=text, text=True, capture_output=True, check=True).stdout
        if opencc := shutil.which("opencc"):
            return subprocess.run([opencc, "-c", "t2s.json"], input=text, text=True, capture_output=True, check=True).stdout
        raise RuntimeError("简体别名转换需要 macOS CoreFoundation、ICU uconv 或 OpenCC")

    foundation = ctypes.CDLL("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation")
    ptr, enc = ctypes.c_void_p, 0x08000100
    functions = {
        "CFStringCreateWithCString": (ptr, [ptr, ctypes.c_char_p, ctypes.c_uint32]),
        "CFStringCreateMutableCopy": (ptr, [ptr, ctypes.c_long, ptr]),
        "CFStringTransform": (ctypes.c_bool, [ptr, ptr, ptr, ctypes.c_bool]),
        "CFStringGetCString": (ctypes.c_bool, [ptr, ctypes.c_char_p, ctypes.c_long, ctypes.c_uint32]),
        "CFRelease": (None, [ptr]),
    }
    for name, (result, args) in functions.items():
        function = getattr(foundation, name)
        function.restype, function.argtypes = result, args
    original = foundation.CFStringCreateWithCString(None, text.encode("utf-8"), enc)
    mutable = foundation.CFStringCreateMutableCopy(None, 0, original)
    transform = foundation.CFStringCreateWithCString(None, b"Hant-Hans", enc)
    buffer = ctypes.create_string_buffer(len(text) * 4 + 1)
    try:
        if not foundation.CFStringTransform(mutable, None, transform, False):
            raise RuntimeError("CoreFoundation 简体别名转换失败")
        if not foundation.CFStringGetCString(mutable, buffer, len(buffer), enc):
            raise RuntimeError("无法读取简体别名")
        return buffer.value.decode("utf-8")
    finally:
        for ref in (original, mutable, transform):
            foundation.CFRelease(ref)


def curated_names():
    # 仅复用现有系统数据中已经逐条核对的来源编号。
    reference = ROOT / "miniprogram/data/aminoAcidReferences.js"
    raw = subprocess.check_output(["node", "-p", "JSON.stringify(require(process.argv[1]))", str(reference)])
    aliases = defaultdict(list)
    for entry in json.loads(raw):
        source = entry["profile"]["source"]
        record_id = source["recordId"]
        prefix = {USDA_URL.format(record_id=record_id): "USDA", TFDA_URL: "TFDA"}.get(source["url"])
        if prefix:
            aliases[f"{prefix}:{record_id}"].append(unicodedata.normalize("NFKC", entry["name"]))
    return aliases


def unique_aliases(name: str, aliases: list[str]) -> list[str]:
    seen = {unicodedata.normalize("NFKC", name).casefold()}
    output = []
    for alias in aliases:
        value = " ".join(alias.split())
        key = unicodedata.normalize("NFKC", value).casefold()
        if key and key not in seen:
            output.append(value)
            seen.add(key)
    return output


def normalized_name(name: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", name).split())


def official_local_aliases() -> dict[str, list[str]]:
    path = ROOT / "cloudfunctions/migrateSystemFoods/foods.json"
    aliases = defaultdict(list)
    for food in json.loads(path.read_text(encoding="utf-8")):
        if food["origin"]["source"] != "china_food_composition_table":
            continue
        match = re.fullmatch(r"([^\[\]]+)\[([^\[\]]+)\]", normalized_name(food["name"]))
        if match:
            name, alternate = match.groups()
            aliases[name.strip()].extend(split_aliases(alternate, r"[,;、]"))
    return aliases


def sample_base_name(name: str) -> str:
    # 只忽略独立的年份采样标注，品种、部位和加工限定原样保留。
    return re.sub(r"\(\s*(?:19|20)\d{2}\s*年\s*(?:取样|采样)\s*\)$", "", name).strip().casefold()


def sample_states(prefix: str, sample: Sample) -> list[str]:
    # 台湾食药署的前处理记录描述实验室制样，单独用标签与样品状态判别成品。
    status = sample.description.split("前處理描述", 1)[0] if prefix == "TFDA" else ""
    text = unicodedata.normalize("NFKC", f"{sample.name}; {status}")
    states = [state for state, pattern in STATE_PATTERNS[prefix].items() if re.search(pattern, text, re.IGNORECASE)]
    if "raw" in states and "cooked" in states:
        states = [state for state in states if state not in {"raw", "cooked"}]
    return states or ["unknown"]


def build_references(archives) -> list[dict]:
    curated = curated_names()
    local_names = official_local_aliases()
    tfda_samples = archives[-1][2]
    chinese = sorted({
        normalized_name(name)
        for sample in tfda_samples.values() for name in [sample.name, *sample.aliases]
        if re.search(r"[\u3400-\u9fff]", name)
    } | set(local_names))
    converted = simplify_chinese("\n".join(chinese)).split("\n")
    if len(chinese) != len(converted):
        raise ValueError("简体别名转换后行数不一致")
    simplified = dict(zip(chinese, converted))
    local_aliases_by_name = defaultdict(list)
    for name, aliases in local_names.items():
        local_aliases_by_name[sample_base_name(simplified[name])].extend(aliases)
    exceeds_protein = Counter()
    missing_protein = Counter()
    references = []
    for prefix, version, samples in archives:
        for record_id, sample in samples.items():
            values = {
                key: next(iter(amounts))
                for key in NUTRIENTS if len(amounts := sample.values.get(key, ())) == 1 and next(iter(amounts)) > 0
            }
            if not values:
                continue
            protein = sample.values.get("protein", ())
            amount = sum(values.values())
            if len(protein) == 1 and amount > next(iter(protein)):
                exceeds_protein[version] += 1
                continue
            if len(protein) != 1:
                if amount > 100_000:
                    raise ValueError(f"氨基酸合计超过样品质量：{prefix}:{record_id}")
                missing_protein[version] += 1
            reference_id = f"{prefix}:{record_id}"
            aliases = []
            for name in curated[reference_id]:
                main, _, alternate = name.partition("[")
                aliases.extend([main, *split_aliases(alternate.rstrip("]"), r"[,;、]")])
            aliases.extend(sample.aliases)
            if prefix == "TFDA":
                aliases.extend(
                    simplified.get(normalized_name(name), name)
                    for name in [sample.name, *sample.aliases]
                )
            source_name, url = (
                ("美国农业部 FoodData Central", USDA_URL.format(record_id=record_id)) if prefix == "USDA"
                else ("台湾食药署食品营养成分资料集", TFDA_URL)
            )
            record = {
                "id": reference_id,
                "name": sample.name,
                "category": sample.category,
                "aliases": unique_aliases(sample.name, aliases),
                "states": sample_states(prefix, sample),
                "profile": {
                    "basis": "g",
                    "values": {key: int(value) if value == int(value) else float(value) for key, value in values.items()},
                    "estimated": True,
                    "source": {"name": f"{source_name} · {sample.name}", "version": version, "recordId": record_id, "url": url},
                },
            }
            composition = {
                key: float(next(iter(amounts)) / 1000)
                for key in ("protein", "fat", "water") if len(amounts := sample.values.get(key, ())) == 1
            }
            if composition:
                record["composition"] = composition
            if curated[reference_id]:
                record["verifiedNames"] = sorted(set(curated[reference_id]))
            if prefix == "TFDA":
                simplified_name = simplified.get(normalized_name(sample.name), sample.name)
                if simplified_name != normalized_name(sample.name):
                    record["simplifiedName"] = simplified_name
            if sample.description:
                record["description"] = " ".join(sample.description.split())[:200]
            if prefix == "TFDA":
                record["englishNames"] = unique_aliases("", sample.english_names)
                base_name = sample_base_name(simplified.get(normalized_name(sample.name), sample.name))
                local_aliases = unique_aliases(sample.name, local_aliases_by_name.get(base_name, []))
                if local_aliases:
                    record["localAliases"] = local_aliases
            references.append(record)
    print("已知氨基酸合计超过同一样品蛋白质而跳过", dict(exceeds_protein))
    print("蛋白质缺失或存在多个值，保留有依据的氨基酸", dict(missing_protein))
    return sorted(references, key=lambda row: row["id"])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sr-legacy", type=Path, required=True, help="USDA SR Legacy CSV 压缩档")
    parser.add_argument("--foundation", type=Path, required=True, help="USDA Foundation JSON 压缩档")
    parser.add_argument("--tfda", type=Path, required=True, help="台湾食药署 JSON 压缩档")
    parser.add_argument("--output", type=Path, default=ROOT / "cloudfunctions/searchAminoAcidReferences/references.json")
    args = parser.parse_args()

    references = build_references([
        ("USDA", *read_legacy(args.sr_legacy)),
        ("USDA", *read_foundation(args.foundation)),
        ("TFDA", *read_tfda(args.tfda)),
    ])
    ids = {row["id"] for row in references}
    if not references or len(ids) != len(references) or {key.split(":")[0] for key in ids} != {"USDA", "TFDA"}:
        raise ValueError("候选库为空、来源不全或含有重复编号")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    # 全部验证完成后再替换已有数据文件。
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=args.output.parent, delete=False) as output:
        lines = (json.dumps(row, ensure_ascii=False, separators=(",", ":")) for row in references)
        output.write("[\n" + ",\n".join(lines) + "\n]\n")
    Path(output.name).chmod(0o644)
    Path(output.name).replace(args.output)
    print("离线候选", len(references), "条", dict(Counter(row["profile"]["source"]["version"] for row in references)))


if __name__ == "__main__":
    main()
