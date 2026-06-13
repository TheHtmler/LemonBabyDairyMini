#!/usr/bin/env python3
"""Convert China food composition xlsx data into system food seed JSON.

The script intentionally uses only the Python standard library so it can run
without installing project-local tooling.
"""

from __future__ import annotations

import argparse
import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path
from zipfile import ZipFile


NS = {
    "a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}
REL_NS = {
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
}

SOURCE_NAME = "china_food_composition_table"

CORE_FIELD_MAP = {
    "能量（千卡）": "calories",
    "蛋白质(g)": "protein",
    "脂肪(g)": "fat",
    "碳水化物(g)": "carbs",
    "膳食纤维(g)": "fiber",
    "钠(mg)": "sodium",
}

EXTRA_FIELD_MAP = {
    "水分(g)": "water",
    "能量（千焦）": "energyKj",
    "胆固醇(mg)": "cholesterol",
    "灰分(g)": "ash",
    "维生素A(μgRE)": "vitaminA",
    "硫胺素(mg)": "thiamin",
    "核黄素(mg)": "riboflavin",
    "维生素B6(mg)": "vitaminB6",
    "维生素B12(mg)": "vitaminB12",
    "叶酸(ug)": "folate",
    "烟碱(mg)": "nicotinamide",
    "维生素C(mg)": "vitaminC",
    "维生素E(mg)": "vitaminE",
    "钙(mg)": "calcium",
    "磷(mg)": "phosphorus",
    "钾(mg)": "potassium",
    "镁(mg)": "magnesium",
    "铁(mg)": "iron",
    "锌(mg)": "zinc",
    "硒(mg)": "selenium",
    "铜(mg)": "copper",
    "锰(mg)": "manganese",
    "碘(mg)": "iodine",
    "胡萝卜素(μg)": "carotene",
    "视黄醇(μg)": "retinol",
    "尼克酸/烟酸(mg)": "niacin",
    "α-维生素E(mg)": "alphaVitaminE",
}

PREMIUM_CATEGORY_KEYWORDS = ("肉", "禽", "鱼", "虾", "蟹", "贝", "水产", "蛋", "乳", "奶", "豆")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="Path to 中国食物成分表 xlsx")
    parser.add_argument("output", type=Path, help="Path to write foods.json")
    return parser.parse_args()


def col_to_index(cell_ref: str) -> int:
    match = re.match(r"([A-Z]+)", cell_ref or "")
    if not match:
        return 0
    value = 0
    for char in match.group(1):
        value = value * 26 + ord(char) - 64
    return value - 1


def load_shared_strings(zip_file: ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in zip_file.namelist():
        return []
    root = ET.fromstring(zip_file.read("xl/sharedStrings.xml"))
    result = []
    for item in root.findall("a:si", NS):
        result.append("".join(text.text or "" for text in item.findall(".//a:t", NS)))
    return result


def sheet_targets(zip_file: ZipFile) -> dict[str, str]:
    workbook = ET.fromstring(zip_file.read("xl/workbook.xml"))
    relationships = ET.fromstring(zip_file.read("xl/_rels/workbook.xml.rels"))
    rel_map = {
        rel.attrib["Id"]: rel.attrib["Target"]
        for rel in relationships.findall("rel:Relationship", REL_NS)
    }

    targets = {}
    for sheet in workbook.findall("a:sheets/a:sheet", NS):
        rel_id = sheet.attrib.get(f"{{{NS['r']}}}id")
        target = rel_map.get(rel_id, "")
        if not target.startswith("xl/"):
            target = f"xl/{target.lstrip('/')}"
        targets[sheet.attrib["name"]] = target
    return targets


def iter_rows(zip_file: ZipFile, target: str, shared_strings: list[str]) -> list[list[str]]:
    root = ET.fromstring(zip_file.read(target))
    rows = []
    for row in root.findall(".//a:sheetData/a:row", NS):
        values: list[str] = []
        last_index = -1
        for cell in row.findall("a:c", NS):
            index = col_to_index(cell.attrib.get("r", ""))
            while last_index + 1 < index:
                values.append("")
                last_index += 1

            cell_type = cell.attrib.get("t")
            raw_value = cell.find("a:v", NS)
            value = ""
            if raw_value is not None and raw_value.text is not None:
                if cell_type == "s":
                    value = shared_strings[int(raw_value.text)]
                else:
                    value = raw_value.text
            elif cell_type == "inlineStr":
                value = "".join(text.text or "" for text in cell.findall(".//a:t", NS))

            values.append(value.strip() if isinstance(value, str) else value)
            last_index = index
        rows.append(values)
    return rows


def to_number(value: str | int | float | None) -> float | int:
    if value in ("", None):
        return 0
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0
    if number.is_integer():
        return int(number)
    return round(number, 4)


def value_for(row: dict[str, str], header: str) -> float | int:
    return to_number(row.get(header, ""))


def load_workbook_rows(path: Path) -> tuple[list[list[str]], list[list[str]]]:
    with ZipFile(path) as zip_file:
        shared_strings = load_shared_strings(zip_file)
        targets = sheet_targets(zip_file)
        food_rows = iter_rows(zip_file, targets["中国食物成分表"], shared_strings)
        category_rows = iter_rows(zip_file, targets["中国食物分类表"], shared_strings)
    return food_rows, category_rows


def build_category_maps(category_rows: list[list[str]]) -> tuple[dict[str, dict[str, str]], dict[str, str]]:
    categories: dict[str, dict[str, str]] = {}
    for row in category_rows[2:]:
        if len(row) < 4 or not row[1]:
            continue
        categories[row[1]] = {
            "code": row[1],
            "parentCode": row[2] if len(row) > 2 else "",
            "name": row[3] if len(row) > 3 else "",
        }

    root_by_code: dict[str, str] = {}
    for code, category in categories.items():
        cursor = category
        while cursor.get("parentCode"):
            cursor = categories.get(cursor["parentCode"], cursor)
            if cursor.get("code") == cursor.get("parentCode"):
                break
        root_by_code[code] = cursor.get("code", code)

    return categories, root_by_code


def infer_protein_quality(category_name: str, category_level2: str) -> str:
    text = f"{category_name}{category_level2}"
    return "premium" if any(keyword in text for keyword in PREMIUM_CATEGORY_KEYWORDS) else "regular"


def convert_foods(food_rows: list[list[str]], category_rows: list[list[str]]) -> list[dict]:
    headers = food_rows[1]
    categories, root_by_code = build_category_maps(category_rows)
    foods = []

    for source_row in food_rows[2:]:
        if not source_row or len(source_row) < 4:
            continue
        row = {
            headers[index]: source_row[index] if index < len(source_row) else ""
            for index in range(len(headers))
        }
        name = (row.get("名  称") or "").strip()
        category_code = (row.get("一级分类编码") or "").strip()
        food_code = (row.get("二级分类编码") or "").strip()
        if not name or not food_code:
            continue

        root_code = root_by_code.get(category_code, category_code[:2])
        root_name = categories.get(root_code, {}).get("name", "")
        level2_name = categories.get(category_code, {}).get("name", "")
        category_name = root_name or level2_name or "未分类"
        nutrition_per_basis = {
            target: value_for(row, source)
            for source, target in CORE_FIELD_MAP.items()
        }
        nutrition_extra = {
            target: value_for(row, source)
            for source, target in EXTRA_FIELD_MAP.items()
        }

        foods.append({
            "name": name,
            "category": category_name,
            "categoryLevel1": category_name,
            "categoryLevel2": level2_name,
            "schemaVersion": 2,
            "recordType": "food_catalog_item",
            "status": "active",
            "sourceType": "system",
            "ownerType": "system",
            "isSystem": True,
            "babyUid": "",
            "sharedBabyUids": [],
            "nutritionBasis": {
                "quantity": 100,
                "unit": "g",
            },
            "nutritionPerBasis": nutrition_per_basis,
            "nutritionExtra": nutrition_extra,
            "origin": {
                "source": SOURCE_NAME,
                "foodCode": food_code,
                "categoryLevel1Code": root_code,
                "categoryLevel2Code": category_code,
                "ediblePercent": value_for(row, "食部(%)"),
            },
            "sourceFoodCode": food_code,
            "categoryLevel1Code": root_code,
            "categoryLevel2Code": category_code,
            "defaultQuantity": 100,
            "image": "",
            "isLiquid": False,
            "nutritionSource": "system",
            "proteinSource": "natural",
            "proteinQuality": infer_protein_quality(category_name, level2_name),
        })

    return foods


def main() -> None:
    args = parse_args()
    food_rows, category_rows = load_workbook_rows(args.input)
    foods = convert_foods(food_rows, category_rows)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(foods, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(foods)} foods to {args.output}")


if __name__ == "__main__":
    main()
