// 氨基酸数值单位为 mg/100g 可食部，缺项省略。
// 基线营养素依次为热量、蛋白质、脂肪、碳水化合物、膳食纤维、钠。
module.exports = [
  {
    code: "011101", name: "小麦",
    baseline: { unit: "g", quantity: 100, nutrients: [338, 11.9, 1.3, 75.2, 10.8, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 588, isoleucine: 493, methionine: 185, threonine: 426, leucine: 1024, lysine: 397, phenylalanine: 711, histidine: 357 },
      source: {
        name: "台湾食药署食品营养成分资料集 · 小麥",
        version: "2026-10-05-755d2f0e4a7c", recordId: "A0300101",
        url: "https://data.gov.tw/dataset/8543",
      },
    },
  },
  {
    code: "011205", name: "麸皮",
    baseline: { unit: "g", quantity: 100, nutrients: [282, 15.8, 4, 61.4, 31.3, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 726, isoleucine: 486, methionine: 234, threonine: 500, leucine: 928, lysine: 600, phenylalanine: 595, tryptophan: 282, histidine: 430 },
      source: {
        name: "美国农业部 FoodData Central · Wheat bran, crude",
        version: "SR Legacy 2018-04", recordId: "169722",
        url: "https://fdc.nal.usda.gov/food-details/169722/nutrients",
      },
    },
  },
  {
    code: "012301", name: "糯米[江米]",
    baseline: { unit: "g", quantity: 100, nutrients: [350, 7.3, 1, 78.3, 0.8, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 416, isoleucine: 294, methionine: 160, threonine: 244, leucine: 563, lysine: 246, phenylalanine: 364, tryptophan: 79, histidine: 160 },
      source: {
        name: "美国农业部 FoodData Central · Rice, white, glutinous, unenriched, uncooked",
        version: "SR Legacy 2018-04", recordId: "168883",
        url: "https://fdc.nal.usda.gov/food-details/168883/nutrients",
      },
    },
  },
  {
    code: "013102", name: "玉米（白，干）",
    baseline: { unit: "g", quantity: 100, nutrients: [352, 8.8, 3.8, 74.7, 8, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 477, isoleucine: 337, methionine: 197, threonine: 354, leucine: 1155, lysine: 265, phenylalanine: 463, tryptophan: 67, histidine: 287 },
      source: {
        name: "美国农业部 FoodData Central · Corn grain, white",
        version: "SR Legacy 2018-04", recordId: "168920",
        url: "https://fdc.nal.usda.gov/food-details/168920/nutrients",
      },
    },
  },
  {
    code: "013103", name: "玉米（黄，干）",
    baseline: { unit: "g", quantity: 100, nutrients: [348, 8.7, 3.8, 73, 6.4, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 477, isoleucine: 337, methionine: 197, threonine: 354, leucine: 1155, lysine: 265, phenylalanine: 463, tryptophan: 67, histidine: 287 },
      source: {
        name: "美国农业部 FoodData Central · Corn grain, yellow",
        version: "SR Legacy 2018-04", recordId: "170288",
        url: "https://fdc.nal.usda.gov/food-details/170288/nutrients",
      },
    },
  },
  {
    code: "013108", name: "玉米粒（黄、干）",
    baseline: { unit: "g", quantity: 100, nutrients: [327, 8, 0.8, 79.2, 0, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 477, isoleucine: 337, methionine: 197, threonine: 354, leucine: 1155, lysine: 265, phenylalanine: 463, tryptophan: 67, histidine: 287 },
      source: {
        name: "美国农业部 FoodData Central · Corn grain, yellow",
        version: "SR Legacy 2018-04", recordId: "170288",
        url: "https://fdc.nal.usda.gov/food-details/170288/nutrients",
      },
    },
  },
  {
    code: "019005", name: "荞麦",
    baseline: { unit: "g", quantity: 100, nutrients: [337, 9.3, 2.3, 73, 6.5, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 678, isoleucine: 498, methionine: 172, threonine: 506, leucine: 832, lysine: 672, phenylalanine: 520, tryptophan: 192, histidine: 309 },
      source: {
        name: "美国农业部 FoodData Central · Buckwheat",
        version: "SR Legacy 2018-04", recordId: "170286",
        url: "https://fdc.nal.usda.gov/food-details/170286/nutrients",
      },
    },
  },
  {
    code: "019012", name: "燕麦",
    baseline: { unit: "g", quantity: 100, nutrients: [338, 10.1, 0.2, 77.4, 6, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 526, isoleucine: 388, methionine: 134, threonine: 385, leucine: 846, lysine: 483, phenylalanine: 543, tryptophan: 91, histidine: 258 },
      source: {
        name: "台湾食药署食品营养成分资料集 · 燕麥",
        version: "2026-10-05-755d2f0e4a7c", recordId: "A0800101",
        url: "https://data.gov.tw/dataset/8543",
      },
    },
  },
  {
    code: "019013", name: "藜麦（散装）",
    baseline: { unit: "g", quantity: 100, nutrients: [357, 14, 6, 57.8, 6.5, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 594, isoleucine: 504, methionine: 309, threonine: 421, leucine: 840, lysine: 766, phenylalanine: 593, tryptophan: 167, histidine: 407 },
      source: {
        name: "美国农业部 FoodData Central · Quinoa, uncooked",
        version: "SR Legacy 2018-04", recordId: "168874",
        url: "https://fdc.nal.usda.gov/food-details/168874/nutrients",
      },
    },
  },
  {
    code: "021301", name: "木薯",
    baseline: { unit: "g", quantity: 100, nutrients: [119, 2.1, 0.3, 27.8, 1.6, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 35, isoleucine: 27, methionine: 11, threonine: 28, leucine: 39, lysine: 44, phenylalanine: 26, tryptophan: 19, histidine: 20 },
      source: {
        name: "美国农业部 FoodData Central · Cassava, raw",
        version: "SR Legacy 2018-04", recordId: "169985",
        url: "https://fdc.nal.usda.gov/food-details/169985/nutrients",
      },
    },
  },
  {
    code: "022103", name: "玉米淀粉",
    baseline: { unit: "g", quantity: 100, nutrients: [346, 1.2, 0.1, 85, 0.1, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 14, isoleucine: 10, methionine: 6, threonine: 9, leucine: 36, lysine: 6, phenylalanine: 13, tryptophan: 1, histidine: 8 },
      source: {
        name: "美国农业部 FoodData Central · Cornstarch",
        version: "SR Legacy 2018-04", recordId: "169698",
        url: "https://fdc.nal.usda.gov/food-details/169698/nutrients",
      },
    },
  },
  {
    code: "031104", name: "黄豆",
    baseline: { unit: "g", quantity: 100, nutrients: [407, 33.1, 15.9, 37.3, 9, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 1643, isoleucine: 1591, methionine: 392, threonine: 1374, leucine: 2699, lysine: 2136, phenylalanine: 1790, tryptophan: 532, histidine: 913 },
      source: {
        name: "台湾食药署食品营养成分资料集 · 黃豆",
        version: "2026-10-05-755d2f0e4a7c", recordId: "H1105101",
        url: "https://data.gov.tw/dataset/8543",
      },
    },
  },
  {
    code: "031506", name: "油豆腐",
    baseline: { unit: "g", quantity: 100, nutrients: [245, 17, 17.6, 4.9, 0.6, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 867, isoleucine: 852, methionine: 220, threonine: 701, leucine: 1306, lysine: 1131, phenylalanine: 837, tryptophan: 268, histidine: 499 },
      source: {
        name: "美国农业部 FoodData Central · Tofu, fried",
        version: "SR Legacy 2018-04", recordId: "172451",
        url: "https://fdc.nal.usda.gov/food-details/172451/nutrients",
      },
    },
  },
  {
    code: "032101", name: "绿豆（干）",
    baseline: { unit: "g", quantity: 100, nutrients: [329, 21.6, 0.8, 62, 6.4, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 1237, isoleucine: 1008, methionine: 286, threonine: 782, leucine: 1847, lysine: 1664, phenylalanine: 1443, tryptophan: 260, histidine: 695 },
      source: {
        name: "美国农业部 FoodData Central · Mung beans, mature seeds, raw",
        version: "SR Legacy 2018-04", recordId: "174256",
        url: "https://fdc.nal.usda.gov/food-details/174256/nutrients",
      },
    },
  },
  {
    code: "033101", name: "赤小豆（干）[小豆，红小豆]",
    baseline: { unit: "g", quantity: 100, nutrients: [324, 20.2, 0.6, 63.4, 7.7, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 1023, isoleucine: 791, methionine: 210, threonine: 674, leucine: 1668, lysine: 1497, phenylalanine: 1052, tryptophan: 191, histidine: 524 },
      source: {
        name: "美国农业部 FoodData Central · Beans, adzuki, mature seeds, raw",
        version: "SR Legacy 2018-04", recordId: "173727",
        url: "https://fdc.nal.usda.gov/food-details/173727/nutrients",
      },
    },
  },
  {
    code: "034104", name: "芸豆（干,红）",
    baseline: { unit: "g", quantity: 100, nutrients: [331, 21.4, 1.3, 62.5, 8.3, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 1179, isoleucine: 995, methionine: 339, threonine: 948, leucine: 1799, lysine: 1547, phenylalanine: 1218, tryptophan: 267, histidine: 627 },
      source: {
        name: "美国农业部 FoodData Central · Beans, kidney, red, mature seeds, raw",
        version: "SR Legacy 2018-04", recordId: "173744",
        url: "https://fdc.nal.usda.gov/food-details/173744/nutrients",
      },
    },
  },
  {
    code: "035101", name: "蚕豆（干）",
    baseline: { unit: "g", quantity: 100, nutrients: [338, 21.6, 1, 61.5, 1.7, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 1161, isoleucine: 1053, methionine: 213, threonine: 928, leucine: 1964, lysine: 1671, phenylalanine: 1103, tryptophan: 247, histidine: 664 },
      source: {
        name: "美国农业部 FoodData Central · Broadbeans (fava beans), mature seeds, raw",
        version: "SR Legacy 2018-04", recordId: "175205",
        url: "https://fdc.nal.usda.gov/food-details/175205/nutrients",
      },
    },
  },
  {
    code: "039202", name: "豇豆（干）",
    baseline: { unit: "g", quantity: 100, nutrients: [336, 19.3, 1.2, 65.6, 7.1, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 1121, isoleucine: 956, methionine: 335, threonine: 895, leucine: 1802, lysine: 1591, phenylalanine: 1373, tryptophan: 290, histidine: 730 },
      source: {
        name: "美国农业部 FoodData Central · Cowpeas, common (blackeyes, crowder, southern), mature seeds, raw",
        version: "SR Legacy 2018-04", recordId: "173758",
        url: "https://fdc.nal.usda.gov/food-details/173758/nutrients",
      },
    },
  },
  {
    code: "039204", name: "豇豆（煮）",
    baseline: { unit: "g", quantity: 100, nutrients: [133, 9.5, 0.6, 24, 0, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 368, isoleucine: 314, methionine: 110, threonine: 294, leucine: 592, lysine: 523, phenylalanine: 451, tryptophan: 95, histidine: 240 },
      source: {
        name: "美国农业部 FoodData Central · Cowpeas, common (blackeyes, crowder, southern), mature seeds, cooked, boiled, without salt",
        version: "SR Legacy 2018-04", recordId: "173759",
        url: "https://fdc.nal.usda.gov/food-details/173759/nutrients",
      },
    },
  },
  {
    code: "039401", name: "鹰嘴豆[桃豆]",
    baseline: { unit: "g", quantity: 100, nutrients: [340, 21.2, 4.2, 60.1, 11.6, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 865, isoleucine: 882, methionine: 270, threonine: 766, leucine: 1465, lysine: 1377, phenylalanine: 1103, tryptophan: 200, histidine: 566 },
      source: {
        name: "美国农业部 FoodData Central · Chickpeas (garbanzo beans, bengal gram), mature seeds, raw",
        version: "SR Legacy 2018-04", recordId: "173756",
        url: "https://fdc.nal.usda.gov/food-details/173756/nutrients",
      },
    },
  },
  {
    code: "039902", name: "木豆（干）[扭豆，豆蓉]",
    baseline: { unit: "g", quantity: 100, nutrients: [348, 19.8, 4.5, 58.8, 3.7, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 937, isoleucine: 785, methionine: 243, threonine: 767, leucine: 1549, lysine: 1521, phenylalanine: 1858, tryptophan: 212, histidine: 774 },
      source: {
        name: "美国农业部 FoodData Central · Pigeon peas (red gram), mature seeds, raw",
        version: "SR Legacy 2018-04", recordId: "172436",
        url: "https://fdc.nal.usda.gov/food-details/172436/nutrients",
      },
    },
  },
  {
    code: "041101", name: "白萝卜（鲜）[莱菔]",
    baseline: { unit: "g", quantity: 100, nutrients: [16, 0.7, 0.1, 4, 0, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 28, isoleucine: 26, methionine: 6, threonine: 25, leucine: 31, lysine: 30, phenylalanine: 20, tryptophan: 3, histidine: 11 },
      source: {
        name: "美国农业部 FoodData Central · Radishes, oriental, raw",
        version: "SR Legacy 2018-04", recordId: "168451",
        url: "https://fdc.nal.usda.gov/food-details/168451/nutrients",
      },
    },
  },
  {
    code: "041204", name: "胡萝卜",
    baseline: { unit: "g", quantity: 100, nutrients: [32, 1, 0.2, 8.1, 0, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 69, isoleucine: 77, methionine: 20, threonine: 191, leucine: 102, lysine: 101, phenylalanine: 61, tryptophan: 12, histidine: 40 },
      source: {
        name: "美国农业部 FoodData Central · Carrots, raw",
        version: "SR Legacy 2018-04", recordId: "170393",
        url: "https://fdc.nal.usda.gov/food-details/170393/nutrients",
      },
    },
  },
  {
    code: "041302", name: "苤蓝[玉蔓菁，球茎甘蓝，大头菜]",
    baseline: { unit: "g", quantity: 100, nutrients: [32, 1.3, 0.2, 7, 1.3, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 50, isoleucine: 78, methionine: 13, threonine: 49, leucine: 67, lysine: 56, phenylalanine: 39, tryptophan: 10, histidine: 19 },
      source: {
        name: "美国农业部 FoodData Central · Kohlrabi, raw",
        version: "SR Legacy 2018-04", recordId: "168424",
        url: "https://fdc.nal.usda.gov/food-details/168424/nutrients",
      },
    },
  },
  {
    code: "041401", name: "甜菜根（鲜）[甜菜头，糖萝卜]",
    baseline: { unit: "g", quantity: 100, nutrients: [87, 1, 0.1, 23.5, 5.9, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 56, isoleucine: 48, methionine: 18, threonine: 47, leucine: 68, lysine: 58, phenylalanine: 46, tryptophan: 19, histidine: 21 },
      source: {
        name: "美国农业部 FoodData Central · Beets, raw",
        version: "SR Legacy 2018-04", recordId: "169145",
        url: "https://fdc.nal.usda.gov/food-details/169145/nutrients",
      },
    },
  },
  {
    code: "042106", name: "荷兰豆",
    baseline: { unit: "g", quantity: 100, nutrients: [30, 2.5, 0.3, 4.9, 1.4, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 273, isoleucine: 161, methionine: 11, threonine: 99, leucine: 228, lysine: 202, phenylalanine: 90, tryptophan: 27, histidine: 17 },
      source: {
        name: "美国农业部 FoodData Central · Peas, edible-podded, raw",
        version: "SR Legacy 2018-04", recordId: "170010",
        url: "https://fdc.nal.usda.gov/food-details/170010/nutrients",
      },
    },
  },
  {
    code: "042109", name: "毛豆（鲜）[青豆，菜用大豆]",
    baseline: { unit: "g", quantity: 100, nutrients: [131, 13.1, 5, 10.5, 4, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 576, isoleucine: 570, methionine: 157, threonine: 516, leucine: 926, lysine: 775, phenylalanine: 586, tryptophan: 157, histidine: 348 },
      source: {
        name: "美国农业部 FoodData Central · Soybeans, green, raw",
        version: "SR Legacy 2018-04", recordId: "169282",
        url: "https://fdc.nal.usda.gov/food-details/169282/nutrients",
      },
    },
  },
  {
    code: "042110", name: "四季豆（菜豆）",
    baseline: { unit: "g", quantity: 100, nutrients: [31, 2, 0.4, 5.7, 1.5, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 90, isoleucine: 66, methionine: 22, threonine: 79, leucine: 112, lysine: 88, phenylalanine: 67, tryptophan: 19, histidine: 34 },
      source: {
        name: "美国农业部 FoodData Central · Beans, snap, green, raw",
        version: "SR Legacy 2018-04", recordId: "169961",
        url: "https://fdc.nal.usda.gov/food-details/169961/nutrients",
      },
    },
  },
  {
    code: "042117", name: "豇豆（长）",
    baseline: { unit: "g", quantity: 100, nutrients: [32, 2.7, 0.2, 5.8, 1.8, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 162, isoleucine: 150, methionine: 40, threonine: 104, leucine: 200, lysine: 184, phenylalanine: 154, tryptophan: 32, histidine: 90 },
      source: {
        name: "美国农业部 FoodData Central · Yardlong bean, raw",
        version: "SR Legacy 2018-04", recordId: "169222",
        url: "https://fdc.nal.usda.gov/food-details/169222/nutrients",
      },
    },
  },
  {
    code: "042120", name: "四季豆[菜豆、芸豆]",
    baseline: { unit: "g", quantity: 100, nutrients: [24, 2, 0.2, 6, 0, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 90, isoleucine: 66, methionine: 22, threonine: 79, leucine: 112, lysine: 88, phenylalanine: 67, tryptophan: 19, histidine: 34 },
      source: {
        name: "美国农业部 FoodData Central · Beans, snap, green, raw",
        version: "SR Legacy 2018-04", recordId: "169961",
        url: "https://fdc.nal.usda.gov/food-details/169961/nutrients",
      },
    },
  },
  {
    code: "042202", name: "黄豆芽",
    baseline: { unit: "g", quantity: 100, nutrients: [47, 4.5, 1.6, 4.5, 1.5, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 241, isoleucine: 234, methionine: 41, threonine: 208, leucine: 420, lysine: 316, phenylalanine: 255, tryptophan: 77, histidine: 153 },
      source: {
        name: "台湾食药署食品营养成分资料集 · 黃豆芽",
        version: "2026-10-05-755d2f0e4a7c", recordId: "E7700401",
        url: "https://data.gov.tw/dataset/8543",
      },
    },
  },
  {
    code: "042206", name: "绿豆芽",
    baseline: { unit: "g", quantity: 100, nutrients: [16, 1.7, 0.1, 2.6, 1.2, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 130, isoleucine: 132, methionine: 34, threonine: 78, leucine: 175, lysine: 166, phenylalanine: 117, tryptophan: 37, histidine: 70 },
      source: {
        name: "美国农业部 FoodData Central · Mung beans, mature seeds, sprouted, raw",
        version: "SR Legacy 2018-04", recordId: "169957",
        url: "https://fdc.nal.usda.gov/food-details/169957/nutrients",
      },
    },
  },
  {
    code: "042208", name: "豌豆苗",
    baseline: { unit: "g", quantity: 100, nutrients: [32, 4.8, 0.8, 2.6, 0, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 185, isoleucine: 140, methionine: 34, threonine: 132, leucine: 228, lysine: 229, phenylalanine: 167, tryptophan: 27, histidine: 96 },
      source: {
        name: "台湾食药署食品营养成分资料集 · 豌豆苗",
        version: "2026-10-05-755d2f0e4a7c", recordId: "E5400101",
        url: "https://data.gov.tw/dataset/8543",
      },
    },
  },
  {
    code: "043101", name: "茄子（代表值）",
    baseline: { unit: "g", quantity: 100, nutrients: [23, 1.1, 0.2, 4.9, 1.3, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 53, isoleucine: 45, methionine: 11, threonine: 37, leucine: 64, lysine: 47, phenylalanine: 43, tryptophan: 9, histidine: 23 },
      source: {
        name: "美国农业部 FoodData Central · Eggplant, raw",
        version: "SR Legacy 2018-04", recordId: "169228",
        url: "https://fdc.nal.usda.gov/food-details/169228/nutrients",
      },
    },
  },
  {
    code: "043119", name: "番茄[西红柿]",
    baseline: { unit: "g", quantity: 100, nutrients: [15, 0.9, 0.2, 3.3, 0, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 18, isoleucine: 18, methionine: 6, threonine: 27, leucine: 25, lysine: 27, phenylalanine: 27, tryptophan: 6, histidine: 14 },
      source: {
        name: "美国农业部 FoodData Central · Tomatoes, red, ripe, raw, year round average",
        version: "SR Legacy 2018-04", recordId: "170457",
        url: "https://fdc.nal.usda.gov/food-details/170457/nutrients",
      },
    },
  },
  {
    code: "043205", name: "佛手瓜[棒瓜，菜肴梨]",
    baseline: { unit: "g", quantity: 100, nutrients: [18, 1.2, 0.1, 3.8, 1.2, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 63, isoleucine: 44, methionine: 1, threonine: 40, leucine: 77, lysine: 39, phenylalanine: 47, tryptophan: 11, histidine: 15 },
      source: {
        name: "美国农业部 FoodData Central · Chayote, fruit, raw",
        version: "SR Legacy 2018-04", recordId: "170402",
        url: "https://fdc.nal.usda.gov/food-details/170402/nutrients",
      },
    },
  },
  {
    code: "043206", name: "葫芦[长瓜，蒲瓜，瓠瓜]",
    baseline: { unit: "g", quantity: 100, nutrients: [16, 0.7, 0.1, 3.5, 0.8, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 27, isoleucine: 33, methionine: 4, threonine: 18, leucine: 36, lysine: 21, phenylalanine: 15, tryptophan: 3, histidine: 4 },
      source: {
        name: "美国农业部 FoodData Central · Gourd, white-flowered (calabash), raw",
        version: "SR Legacy 2018-04", recordId: "169232",
        url: "https://fdc.nal.usda.gov/food-details/169232/nutrients",
      },
    },
  },
  {
    code: "043213", name: "南瓜（鲜）[倭瓜，番瓜]",
    baseline: { unit: "g", quantity: 100, nutrients: [23, 0.7, 0.1, 5.3, 0.8, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 35, isoleucine: 31, methionine: 11, threonine: 29, leucine: 46, lysine: 54, phenylalanine: 32, tryptophan: 12, histidine: 16 },
      source: {
        name: "美国农业部 FoodData Central · Pumpkin, raw",
        version: "SR Legacy 2018-04", recordId: "168448",
        url: "https://fdc.nal.usda.gov/food-details/168448/nutrients",
      },
    },
  },
  {
    code: "043218", name: "西葫芦",
    baseline: { unit: "g", quantity: 100, nutrients: [19, 0.8, 0.2, 3.8, 0.6, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 54, isoleucine: 44, methionine: 18, threonine: 29, leucine: 71, lysine: 67, phenylalanine: 43, tryptophan: 10, histidine: 26 },
      source: {
        name: "美国农业部 FoodData Central · Squash, summer, zucchini, includes skin, raw",
        version: "SR Legacy 2018-04", recordId: "169291",
        url: "https://fdc.nal.usda.gov/food-details/169291/nutrients",
      },
    },
  },
  {
    code: "043221", name: "冬瓜",
    baseline: { unit: "g", quantity: 100, nutrients: [12, 0.3, 0.2, 2.4, 0, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { methionine: 3, lysine: 9, tryptophan: 2 },
      source: {
        name: "美国农业部 FoodData Central · Waxgourd, (chinese preserving melon), raw",
        version: "SR Legacy 2018-04", recordId: "170069",
        url: "https://fdc.nal.usda.gov/food-details/170069/nutrients",
      },
    },
  },
  {
    code: "043222", name: "飞碟瓜",
    baseline: { unit: "g", quantity: 100, nutrients: [18, 1, 0.1, 4.4, 1.6, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 54, isoleucine: 43, methionine: 17, threonine: 29, leucine: 70, lysine: 67, phenylalanine: 42, tryptophan: 11, histidine: 26 },
      source: {
        name: "美国农业部 FoodData Central · Squash, summer, scallop, raw",
        version: "SR Legacy 2018-04", recordId: "169289",
        url: "https://fdc.nal.usda.gov/food-details/169289/nutrients",
      },
    },
  },
  {
    code: "044206", name: "大葱",
    baseline: { unit: "g", quantity: 100, nutrients: [28, 1.6, 0.3, 5.8, 2.2, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 84, isoleucine: 81, methionine: 21, threonine: 74, leucine: 113, lysine: 95, phenylalanine: 61, tryptophan: 21, histidine: 33 },
      source: {
        name: "美国农业部 FoodData Central · Onions, welsh, raw",
        version: "SR Legacy 2018-04", recordId: "170007",
        url: "https://fdc.nal.usda.gov/food-details/170007/nutrients",
      },
    },
  },
  {
    code: "044207", name: "细香葱[香葱，四季葱]",
    baseline: { unit: "g", quantity: 100, nutrients: [28, 1.4, 0.3, 6.6, 0, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 145, isoleucine: 139, methionine: 36, threonine: 128, leucine: 195, lysine: 163, phenylalanine: 105, tryptophan: 37, histidine: 57 },
      source: {
        name: "美国农业部 FoodData Central · Chives, raw",
        version: "SR Legacy 2018-04", recordId: "169994",
        url: "https://fdc.nal.usda.gov/food-details/169994/nutrients",
      },
    },
  },
  {
    code: "044301", name: "洋葱（鲜）[葱头]",
    baseline: { unit: "g", quantity: 100, nutrients: [40, 1.1, 0.2, 9, 0.9, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 21, isoleucine: 14, methionine: 2, threonine: 21, leucine: 25, lysine: 39, phenylalanine: 25, tryptophan: 14, histidine: 14 },
      source: {
        name: "美国农业部 FoodData Central · Onions, raw",
        version: "SR Legacy 2018-04", recordId: "170000",
        url: "https://fdc.nal.usda.gov/food-details/170000/nutrients",
      },
    },
  },
  {
    code: "044404", name: "韭菜",
    baseline: { unit: "g", quantity: 100, nutrients: [25, 2.4, 0.4, 4.5, 0, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 110, isoleucine: 86, methionine: 16, threonine: 93, leucine: 148, lysine: 112, phenylalanine: 100, tryptophan: 16, histidine: 35 },
      source: {
        name: "台湾食药署食品营养成分资料集 · 韮菜",
        version: "2026-10-05-755d2f0e4a7c", recordId: "E2600201",
        url: "https://data.gov.tw/dataset/8543",
      },
    },
  },
  {
    code: "045101", name: "大白菜（代表值）",
    baseline: { unit: "g", quantity: 100, nutrients: [20, 1.6, 0.2, 3.4, 0.9, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 53, isoleucine: 68, methionine: 7, threonine: 39, leucine: 70, lysine: 71, phenylalanine: 35, tryptophan: 12, histidine: 21 },
      source: {
        name: "美国农业部 FoodData Central · Cabbage, chinese (pe-tsai), raw",
        version: "SR Legacy 2018-04", recordId: "169979",
        url: "https://fdc.nal.usda.gov/food-details/169979/nutrients",
      },
    },
  },
  {
    code: "045120", name: "小白菜[青菜]",
    baseline: { unit: "g", quantity: 100, nutrients: [14, 1.4, 0.3, 2.4, 0, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 66, isoleucine: 85, methionine: 9, threonine: 49, leucine: 88, lysine: 89, phenylalanine: 44, tryptophan: 15, histidine: 26 },
      source: {
        name: "美国农业部 FoodData Central · Cabbage, chinese (pak-choi), raw",
        version: "SR Legacy 2018-04", recordId: "170390",
        url: "https://fdc.nal.usda.gov/food-details/170390/nutrients",
      },
    },
  },
  {
    code: "045201", name: "圆白菜，卷心菜",
    baseline: { unit: "g", quantity: 100, nutrients: [24, 1.5, 0.2, 4.6, 1, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 42, isoleucine: 30, methionine: 12, threonine: 35, leucine: 41, lysine: 44, phenylalanine: 32, tryptophan: 11, histidine: 22 },
      source: {
        name: "美国农业部 FoodData Central · Cabbage, raw",
        version: "SR Legacy 2018-04", recordId: "169975",
        url: "https://fdc.nal.usda.gov/food-details/169975/nutrients",
      },
    },
  },
  {
    code: "045210", name: "结球甘蓝（绿）[圆白菜]",
    baseline: { unit: "g", quantity: 100, nutrients: [17, 0.9, 0.2, 4, 0, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 42, isoleucine: 30, methionine: 12, threonine: 35, leucine: 41, lysine: 44, phenylalanine: 32, tryptophan: 11, histidine: 22 },
      source: {
        name: "美国农业部 FoodData Central · Cabbage, raw",
        version: "SR Legacy 2018-04", recordId: "169975",
        url: "https://fdc.nal.usda.gov/food-details/169975/nutrients",
      },
    },
  },
  {
    code: "045211", name: "结球甘蓝（紫）[圆白菜]",
    baseline: { unit: "g", quantity: 100, nutrients: [25, 1.2, 0.2, 6.2, 0, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 48, isoleucine: 34, methionine: 14, threonine: 39, leucine: 46, lysine: 49, phenylalanine: 36, tryptophan: 12, histidine: 24 },
      source: {
        name: "美国农业部 FoodData Central · Cabbage, red, raw",
        version: "SR Legacy 2018-04", recordId: "169977",
        url: "https://fdc.nal.usda.gov/food-details/169977/nutrients",
      },
    },
  },
  {
    code: "045212", name: "抱子甘蓝[小圆白菜]",
    baseline: { unit: "g", quantity: 100, nutrients: [36, 3.5, 0.2, 8.8, 0, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 155, isoleucine: 132, methionine: 32, threonine: 120, leucine: 152, lysine: 154, phenylalanine: 98, tryptophan: 37, histidine: 76 },
      source: {
        name: "美国农业部 FoodData Central · Brussels sprouts, raw",
        version: "SR Legacy 2018-04", recordId: "170383",
        url: "https://fdc.nal.usda.gov/food-details/170383/nutrients",
      },
    },
  },
  {
    code: "045216", name: "菜花（白色）[花椰菜]",
    baseline: { unit: "g", quantity: 100, nutrients: [20, 1.7, 0.2, 4.2, 2.1, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 125, isoleucine: 71, methionine: 20, threonine: 76, leucine: 106, lysine: 217, phenylalanine: 65, tryptophan: 20, histidine: 56 },
      source: {
        name: "美国农业部 FoodData Central · Cauliflower, raw",
        version: "SR Legacy 2018-04", recordId: "169986",
        url: "https://fdc.nal.usda.gov/food-details/169986/nutrients",
      },
    },
  },
  {
    code: "045217", name: "西兰花[绿菜花]",
    baseline: { unit: "g", quantity: 100, nutrients: [27, 3.5, 0.6, 3.7, 0, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 125, isoleucine: 79, methionine: 38, threonine: 88, leucine: 129, lysine: 135, phenylalanine: 117, tryptophan: 33, histidine: 59 },
      source: {
        name: "美国农业部 FoodData Central · Broccoli, raw",
        version: "Foundation 2026-10-29", recordId: "747447",
        url: "https://fdc.nal.usda.gov/food-details/747447/nutrients",
      },
    },
  },
  {
    code: "045301", name: "菠菜（鲜）[赤根菜]",
    baseline: { unit: "g", quantity: 100, nutrients: [28, 2.6, 0.3, 4.5, 1.7, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 161, isoleucine: 147, methionine: 53, threonine: 122, leucine: 223, lysine: 174, phenylalanine: 129, tryptophan: 39, histidine: 64 },
      source: {
        name: "美国农业部 FoodData Central · Spinach, raw",
        version: "SR Legacy 2018-04", recordId: "168462",
        url: "https://fdc.nal.usda.gov/food-details/168462/nutrients",
      },
    },
  },
  {
    code: "045316", name: "甜菜叶（鲜）",
    baseline: { unit: "g", quantity: 100, nutrients: [22, 1.8, 0.1, 4, 1.3, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 65, isoleucine: 46, methionine: 18, threonine: 65, leucine: 98, lysine: 64, phenylalanine: 58, tryptophan: 35, histidine: 34 },
      source: {
        name: "美国农业部 FoodData Central · Beet greens, raw",
        version: "SR Legacy 2018-04", recordId: "170375",
        url: "https://fdc.nal.usda.gov/food-details/170375/nutrients",
      },
    },
  },
  {
    code: "045332", name: "西芹[西洋芹菜，美芹]",
    baseline: { unit: "g", quantity: 100, nutrients: [17, 0.6, 0.1, 4.8, 2.2, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 27, isoleucine: 21, methionine: 5, threonine: 20, leucine: 32, lysine: 27, phenylalanine: 20, tryptophan: 9, histidine: 12 },
      source: {
        name: "美国农业部 FoodData Central · Celery, raw",
        version: "SR Legacy 2018-04", recordId: "169988",
        url: "https://fdc.nal.usda.gov/food-details/169988/nutrients",
      },
    },
  },
  {
    code: "045337", name: "蕹菜[空心菜，藤藤菜]",
    baseline: { unit: "g", quantity: 100, nutrients: [19, 2.2, 0.2, 4, 0, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 135, isoleucine: 104, methionine: 44, threonine: 140, leucine: 146, lysine: 109, phenylalanine: 127, histidine: 47 },
      source: {
        name: "美国农业部 FoodData Central · Water convolvulus,raw",
        version: "SR Legacy 2018-04", recordId: "169301",
        url: "https://fdc.nal.usda.gov/food-details/169301/nutrients",
      },
    },
  },
  {
    code: "045401", name: "竹笋（鲜）",
    baseline: { unit: "g", quantity: 100, nutrients: [23, 2.6, 0.2, 3.6, 1.8, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 106, isoleucine: 88, methionine: 30, threonine: 86, leucine: 140, lysine: 134, phenylalanine: 90, tryptophan: 27, histidine: 42 },
      source: {
        name: "美国农业部 FoodData Central · Bamboo shoots, raw",
        version: "SR Legacy 2018-04", recordId: "169210",
        url: "https://fdc.nal.usda.gov/food-details/169210/nutrients",
      },
    },
  },
  {
    code: "045420", name: "红薯叶",
    baseline: { unit: "g", quantity: 100, nutrients: [27, 3.1, 0, 5.1, 2.8, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { methionine: 86, lysine: 228, tryptophan: 35 },
      source: {
        name: "美国农业部 FoodData Central · Sweet potato leaves, raw",
        version: "SR Legacy 2018-04", recordId: "169303",
        url: "https://fdc.nal.usda.gov/food-details/169303/nutrients",
      },
    },
  },
  {
    code: "046002", name: "豆瓣菜（鲜）[西洋菜，水田芥]",
    baseline: { unit: "g", quantity: 100, nutrients: [20, 2.9, 0.5, 1.5, 1.2, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 137, isoleucine: 93, methionine: 20, threonine: 133, leucine: 166, lysine: 134, phenylalanine: 114, tryptophan: 30, histidine: 40 },
      source: {
        name: "美国农业部 FoodData Central · Watercress, raw",
        version: "SR Legacy 2018-04", recordId: "170068",
        url: "https://fdc.nal.usda.gov/food-details/170068/nutrients",
      },
    },
  },
  {
    code: "046010", name: "藕[莲藕]",
    baseline: { unit: "g", quantity: 100, nutrients: [47, 1.2, 0.2, 11.5, 1.2, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 55, isoleucine: 54, methionine: 22, threonine: 51, leucine: 69, lysine: 94, phenylalanine: 47, tryptophan: 20, histidine: 38 },
      source: {
        name: "美国农业部 FoodData Central · Lotus root, raw",
        version: "SR Legacy 2018-04", recordId: "169250",
        url: "https://fdc.nal.usda.gov/food-details/169250/nutrients",
      },
    },
  },
  {
    code: "047102", name: "豆薯（鲜）[凉薯，地瓜，沙葛]",
    baseline: { unit: "g", quantity: 100, nutrients: [56, 0.9, 0.1, 13.4, 0.8, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 22, isoleucine: 16, methionine: 7, threonine: 18, leucine: 25, lysine: 26, phenylalanine: 17, histidine: 19 },
      source: {
        name: "美国农业部 FoodData Central · Yambean (jicama), raw",
        version: "SR Legacy 2018-04", recordId: "170073",
        url: "https://fdc.nal.usda.gov/food-details/170073/nutrients",
      },
    },
  },
  {
    code: "047203", name: "芋头[芋艿、毛芋]",
    baseline: { unit: "g", quantity: 100, nutrients: [56, 1.3, 0.2, 12.7, 1, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 82, isoleucine: 54, methionine: 20, threonine: 69, leucine: 111, lysine: 67, phenylalanine: 82, tryptophan: 23, histidine: 34 },
      source: {
        name: "美国农业部 FoodData Central · Taro, raw",
        version: "SR Legacy 2018-04", recordId: "169308",
        url: "https://fdc.nal.usda.gov/food-details/169308/nutrients",
      },
    },
  },
  {
    code: "047301", name: "姜（鲜）[黄姜]",
    baseline: { unit: "g", quantity: 100, nutrients: [46, 1.3, 0.6, 10.3, 2.7, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 73, isoleucine: 51, methionine: 13, threonine: 36, leucine: 74, lysine: 57, phenylalanine: 45, tryptophan: 12, histidine: 30 },
      source: {
        name: "美国农业部 FoodData Central · Ginger root, raw",
        version: "SR Legacy 2018-04", recordId: "169231",
        url: "https://fdc.nal.usda.gov/food-details/169231/nutrients",
      },
    },
  },
  {
    code: "051008", name: "金针菇（鲜）[智力菇]",
    baseline: { unit: "g", quantity: 100, nutrients: [32, 2.4, 0.4, 6, 2.7, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 230, isoleucine: 90, methionine: 30, threonine: 110, leucine: 130, lysine: 130, phenylalanine: 150, tryptophan: 40, histidine: 70 },
      source: {
        name: "美国农业部 FoodData Central · Mushrooms, enoki, raw",
        version: "SR Legacy 2018-04", recordId: "169382",
        url: "https://fdc.nal.usda.gov/food-details/169382/nutrients",
      },
    },
  },
  {
    code: "051015", name: "平菇[糙皮侧耳，青蘑]",
    baseline: { unit: "g", quantity: 100, nutrients: [24, 1.9, 0.3, 4.6, 2.3, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 197, isoleucine: 112, methionine: 42, threonine: 140, leucine: 168, lysine: 126, phenylalanine: 112, tryptophan: 42, histidine: 70 },
      source: {
        name: "美国农业部 FoodData Central · Mushrooms, oyster, raw",
        version: "SR Legacy 2018-04", recordId: "168580",
        url: "https://fdc.nal.usda.gov/food-details/168580/nutrients",
      },
    },
  },
  {
    code: "051017", name: "双孢蘑菇[洋蘑菇]",
    baseline: { unit: "g", quantity: 100, nutrients: [26, 4.2, 0.1, 2.7, 1.5, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 232, isoleucine: 76, methionine: 31, threonine: 107, leucine: 120, lysine: 107, phenylalanine: 85, tryptophan: 35, histidine: 57 },
      source: {
        name: "美国农业部 FoodData Central · Mushrooms, white, raw",
        version: "SR Legacy 2018-04", recordId: "169251",
        url: "https://fdc.nal.usda.gov/food-details/169251/nutrients",
      },
    },
  },
  {
    code: "051019", name: "香菇（鲜）[香蕈，冬菇]",
    baseline: { unit: "g", quantity: 100, nutrients: [26, 2.2, 0.3, 5.2, 3.3, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 145, isoleucine: 111, methionine: 33, threonine: 134, leucine: 189, lysine: 134, phenylalanine: 111, tryptophan: 11, histidine: 56 },
      source: {
        name: "美国农业部 FoodData Central · Mushrooms, shiitake, raw",
        version: "SR Legacy 2018-04", recordId: "169242",
        url: "https://fdc.nal.usda.gov/food-details/169242/nutrients",
      },
    },
  },
  {
    code: "051028", name: "白蘑菇[双孢蘑菇、洋蘑菇]",
    baseline: { unit: "g", quantity: 100, nutrients: [29, 3.5, 0.4, 3.8, 0, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 232, isoleucine: 76, methionine: 31, threonine: 107, leucine: 120, lysine: 107, phenylalanine: 85, tryptophan: 35, histidine: 57 },
      source: {
        name: "美国农业部 FoodData Central · Mushrooms, white, raw",
        version: "SR Legacy 2018-04", recordId: "169251",
        url: "https://fdc.nal.usda.gov/food-details/169251/nutrients",
      },
    },
  },
  {
    code: "051048", name: "平菇[糙皮侧耳、青蘑]",
    baseline: { unit: "g", quantity: 100, nutrients: [17, 1.7, 0.1, 3.2, 0, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 197, isoleucine: 112, methionine: 42, threonine: 140, leucine: 168, lysine: 126, phenylalanine: 112, tryptophan: 42, histidine: 70 },
      source: {
        name: "美国农业部 FoodData Central · Mushrooms, oyster, raw",
        version: "SR Legacy 2018-04", recordId: "168580",
        url: "https://fdc.nal.usda.gov/food-details/168580/nutrients",
      },
    },
  },
  {
    code: "052009", name: "螺旋藻（干）",
    baseline: { unit: "g", quantity: 100, nutrients: [358, 64.7, 3.1, 18.2, 1, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 3512, isoleucine: 3209, methionine: 1149, threonine: 2970, leucine: 4947, lysine: 3025, phenylalanine: 2777, tryptophan: 929, histidine: 1085 },
      source: {
        name: "美国农业部 FoodData Central · Seaweed, spirulina, dried",
        version: "SR Legacy 2018-04", recordId: "170495",
        url: "https://fdc.nal.usda.gov/food-details/170495/nutrients",
      },
    },
  },
  {
    code: "061202", name: "梨（巴梨）",
    baseline: { unit: "g", quantity: 100, nutrients: [51, 0.4, 0.2, 12.9, 2.2, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 19, isoleucine: 14, methionine: 2, threonine: 13, leucine: 23, lysine: 21, phenylalanine: 13, tryptophan: 2, histidine: 2 },
      source: {
        name: "美国农业部 FoodData Central · Pears, raw, bartlett",
        version: "Foundation 2026-10-29", recordId: "746773",
        url: "https://fdc.nal.usda.gov/food-details/746773/nutrients",
      },
    },
  },
  {
    code: "061227", name: "鳄梨",
    baseline: { unit: "g", quantity: 100, nutrients: [171, 2, 15.3, 7.4, 2.1, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 107, isoleucine: 84, methionine: 38, threonine: 73, leucine: 143, lysine: 132, phenylalanine: 97, tryptophan: 25, histidine: 49 },
      source: {
        name: "美国农业部 FoodData Central · Avocados, raw, all commercial varieties",
        version: "SR Legacy 2018-04", recordId: "171705",
        url: "https://fdc.nal.usda.gov/food-details/171705/nutrients",
      },
    },
  },
  {
    code: "062105", name: "桃（黄桃）",
    baseline: { unit: "g", quantity: 100, nutrients: [56, 0.5, 0.1, 14, 1.2, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 21, isoleucine: 16, methionine: 9, threonine: 15, leucine: 26, lysine: 28, phenylalanine: 18, tryptophan: 9, histidine: 12 },
      source: {
        name: "美国农业部 FoodData Central · Peaches, yellow, raw",
        version: "Foundation 2026-10-29", recordId: "325430",
        url: "https://fdc.nal.usda.gov/food-details/325430/nutrients",
      },
    },
  },
  {
    code: "062201", name: "李子",
    baseline: { unit: "g", quantity: 100, nutrients: [38, 0.7, 0.2, 8.7, 0.9, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 16, isoleucine: 14, methionine: 8, threonine: 10, leucine: 15, lysine: 16, phenylalanine: 14, tryptophan: 9, histidine: 9 },
      source: {
        name: "美国农业部 FoodData Central · Plums, raw",
        version: "SR Legacy 2018-04", recordId: "169949",
        url: "https://fdc.nal.usda.gov/food-details/169949/nutrients",
      },
    },
  },
  {
    code: "062204", name: "杏",
    baseline: { unit: "g", quantity: 100, nutrients: [38, 0.9, 0.1, 9.1, 1.3, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 47, isoleucine: 41, methionine: 6, threonine: 47, leucine: 77, lysine: 97, phenylalanine: 52, tryptophan: 15, histidine: 27 },
      source: {
        name: "美国农业部 FoodData Central · Apricots, raw",
        version: "SR Legacy 2018-04", recordId: "171697",
        url: "https://fdc.nal.usda.gov/food-details/171697/nutrients",
      },
    },
  },
  {
    code: "063301", name: "柿",
    baseline: { unit: "g", quantity: 100, nutrients: [74, 0.4, 0.1, 18.5, 1.4, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 30, isoleucine: 25, methionine: 5, threonine: 30, leucine: 42, lysine: 33, phenylalanine: 26, tryptophan: 10, histidine: 12 },
      source: {
        name: "美国农业部 FoodData Central · Persimmons, japanese, raw",
        version: "SR Legacy 2018-04", recordId: "169941",
        url: "https://fdc.nal.usda.gov/food-details/169941/nutrients",
      },
    },
  },
  {
    code: "063304", name: "柿饼",
    baseline: { unit: "g", quantity: 100, nutrients: [255, 1.8, 0.2, 62.8, 2.6, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 72, isoleucine: 60, methionine: 12, threonine: 71, leucine: 101, lysine: 78, phenylalanine: 63, tryptophan: 24, histidine: 27 },
      source: {
        name: "美国农业部 FoodData Central · Persimmons, japanese, dried",
        version: "SR Legacy 2018-04", recordId: "169942",
        url: "https://fdc.nal.usda.gov/food-details/169942/nutrients",
      },
    },
  },
  {
    code: "063908", name: "无花果",
    baseline: { unit: "g", quantity: 100, nutrients: [65, 1.5, 0.1, 16, 3, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 28, isoleucine: 23, methionine: 6, threonine: 24, leucine: 33, lysine: 30, phenylalanine: 18, tryptophan: 6, histidine: 11 },
      source: {
        name: "美国农业部 FoodData Central · Figs, raw",
        version: "SR Legacy 2018-04", recordId: "173021",
        url: "https://fdc.nal.usda.gov/food-details/173021/nutrients",
      },
    },
  },
  {
    code: "063910", name: "草莓[洋莓，凤阳草莓]",
    baseline: { unit: "g", quantity: 100, nutrients: [32, 1, 0.2, 7.1, 1.1, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 19, isoleucine: 16, methionine: 2, threonine: 20, leucine: 34, lysine: 26, phenylalanine: 19, tryptophan: 8, histidine: 12 },
      source: {
        name: "美国农业部 FoodData Central · Strawberries, raw",
        version: "SR Legacy 2018-04", recordId: "167762",
        url: "https://fdc.nal.usda.gov/food-details/167762/nutrients",
      },
    },
  },
  {
    code: "064101", name: "橙",
    baseline: { unit: "g", quantity: 100, nutrients: [48, 0.8, 0.2, 11.1, 0.6, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 40, isoleucine: 25, methionine: 20, threonine: 15, leucine: 23, lysine: 47, phenylalanine: 31, tryptophan: 9, histidine: 18 },
      source: {
        name: "美国农业部 FoodData Central · Oranges, raw, all commercial varieties",
        version: "SR Legacy 2018-04", recordId: "169097",
        url: "https://fdc.nal.usda.gov/food-details/169097/nutrients",
      },
    },
  },
  {
    code: "064201", name: "柑桔（均值）",
    baseline: { unit: "g", quantity: 100, nutrients: [51, 0.7, 0.2, 11.9, 0.4, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 21, isoleucine: 17, methionine: 2, threonine: 16, leucine: 28, lysine: 32, phenylalanine: 18, tryptophan: 2, histidine: 11 },
      source: {
        name: "美国农业部 FoodData Central · Tangerines, (mandarin oranges), raw",
        version: "SR Legacy 2018-04", recordId: "169105",
        url: "https://fdc.nal.usda.gov/food-details/169105/nutrients",
      },
    },
  },
  {
    code: "064303", name: "葡萄柚[西柚]",
    baseline: { unit: "g", quantity: 100, nutrients: [33, 0.7, 0.3, 7.8, 0, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 12, isoleucine: 7, methionine: 6, threonine: 11, leucine: 12, lysine: 16, phenylalanine: 38, tryptophan: 6, histidine: 6 },
      source: {
        name: "美国农业部 FoodData Central · Grapefruit, raw, pink and red and white, all areas",
        version: "SR Legacy 2018-04", recordId: "173033",
        url: "https://fdc.nal.usda.gov/food-details/173033/nutrients",
      },
    },
  },
  {
    code: "065002", name: "菠萝[凤梨，地菠萝]",
    baseline: { unit: "g", quantity: 100, nutrients: [44, 0.5, 0.1, 10.8, 1.3, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 24, isoleucine: 19, methionine: 12, threonine: 19, leucine: 24, lysine: 26, phenylalanine: 21, tryptophan: 5, histidine: 10 },
      source: {
        name: "美国农业部 FoodData Central · Pineapple, raw, all varieties",
        version: "SR Legacy 2018-04", recordId: "169124",
        url: "https://fdc.nal.usda.gov/food-details/169124/nutrients",
      },
    },
  },
  {
    code: "065005", name: "番石榴[鸡矢果，番桃]",
    baseline: { unit: "g", quantity: 100, nutrients: [53, 1.1, 0.4, 14.2, 5.9, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 87, isoleucine: 93, methionine: 16, threonine: 96, leucine: 171, lysine: 72, phenylalanine: 6, tryptophan: 22, histidine: 22 },
      source: {
        name: "美国农业部 FoodData Central · Guavas, common, raw",
        version: "SR Legacy 2018-04", recordId: "173044",
        url: "https://fdc.nal.usda.gov/food-details/173044/nutrients",
      },
    },
  },
  {
    code: "065007", name: "桂圆（干）",
    baseline: { unit: "g", quantity: 100, nutrients: [277, 5, 0.2, 64.8, 2, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 217, isoleucine: 97, methionine: 49, threonine: 128, leucine: 202, lysine: 172, phenylalanine: 112, histidine: 45 },
      source: {
        name: "美国农业部 FoodData Central · Longans, dried",
        version: "SR Legacy 2018-04", recordId: "169907",
        url: "https://fdc.nal.usda.gov/food-details/169907/nutrients",
      },
    },
  },
  {
    code: "065010", name: "荔枝",
    baseline: { unit: "g", quantity: 100, nutrients: [71, 0.9, 0.2, 16.6, 0.5, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { methionine: 9, lysine: 41, tryptophan: 7 },
      source: {
        name: "美国农业部 FoodData Central · Litchis, raw",
        version: "SR Legacy 2018-04", recordId: "169086",
        url: "https://fdc.nal.usda.gov/food-details/169086/nutrients",
      },
    },
  },
  {
    code: "065011", name: "芒果[抹猛果，望果]",
    baseline: { unit: "g", quantity: 100, nutrients: [35, 0.6, 0.2, 8.3, 1.3, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 42, isoleucine: 29, methionine: 8, threonine: 31, leucine: 50, lysine: 66, phenylalanine: 27, tryptophan: 13, histidine: 19 },
      source: {
        name: "美国农业部 FoodData Central · Mangos, raw",
        version: "SR Legacy 2018-04", recordId: "169910",
        url: "https://fdc.nal.usda.gov/food-details/169910/nutrients",
      },
    },
  },
  {
    code: "065012", name: "木瓜[番木瓜]",
    baseline: { unit: "g", quantity: 100, nutrients: [29, 0.4, 0.1, 7, 0.8, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 10, isoleucine: 8, methionine: 2, threonine: 11, leucine: 16, lysine: 25, phenylalanine: 9, tryptophan: 8, histidine: 5 },
      source: {
        name: "美国农业部 FoodData Central · Papayas, raw",
        version: "SR Legacy 2018-04", recordId: "169926",
        url: "https://fdc.nal.usda.gov/food-details/169926/nutrients",
      },
    },
  },
  {
    code: "065016", name: "杨桃",
    baseline: { unit: "g", quantity: 100, nutrients: [31, 0.6, 0.2, 7.4, 1.2, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 50, isoleucine: 44, methionine: 21, threonine: 44, leucine: 77, lysine: 77, phenylalanine: 37, tryptophan: 8, histidine: 8 },
      source: {
        name: "美国农业部 FoodData Central · Carambola, (starfruit), raw",
        version: "SR Legacy 2018-04", recordId: "171715",
        url: "https://fdc.nal.usda.gov/food-details/171715/nutrients",
      },
    },
  },
  {
    code: "065018", name: "枇杷",
    baseline: { unit: "g", quantity: 100, nutrients: [41, 0.8, 0.2, 9.3, 0.8, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 21, isoleucine: 15, methionine: 4, threonine: 15, leucine: 26, lysine: 23, phenylalanine: 14, tryptophan: 5, histidine: 7 },
      source: {
        name: "美国农业部 FoodData Central · Loquats, raw",
        version: "SR Legacy 2018-04", recordId: "169908",
        url: "https://fdc.nal.usda.gov/food-details/169908/nutrients",
      },
    },
  },
  {
    code: "065024", name: "荔枝（干）",
    baseline: { unit: "g", quantity: 100, nutrients: [328, 4.5, 1.2, 77.4, 0, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { methionine: 42, lysine: 187, tryptophan: 33 },
      source: {
        name: "美国农业部 FoodData Central · Litchis, dried",
        version: "SR Legacy 2018-04", recordId: "169087",
        url: "https://fdc.nal.usda.gov/food-details/169087/nutrients",
      },
    },
  },
  {
    code: "065033", name: "香蕉[甘蕉]",
    baseline: { unit: "g", quantity: 100, nutrients: [93, 1.4, 0.2, 22, 1.2, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 47, isoleucine: 28, methionine: 8, threonine: 28, leucine: 68, lysine: 50, phenylalanine: 49, tryptophan: 9, histidine: 77 },
      source: {
        name: "美国农业部 FoodData Central · Bananas, raw",
        version: "SR Legacy 2018-04", recordId: "173944",
        url: "https://fdc.nal.usda.gov/food-details/173944/nutrients",
      },
    },
  },
  {
    code: "066201", name: "西瓜（代表值）",
    baseline: { unit: "g", quantity: 100, nutrients: [31, 0.5, 0.3, 6.8, 0.2, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 16, isoleucine: 19, methionine: 6, threonine: 27, leucine: 18, lysine: 62, phenylalanine: 15, tryptophan: 7, histidine: 6 },
      source: {
        name: "美国农业部 FoodData Central · Watermelon, raw",
        version: "SR Legacy 2018-04", recordId: "167765",
        url: "https://fdc.nal.usda.gov/food-details/167765/nutrients",
      },
    },
  },
  {
    code: "071008", name: "栗子（鲜）[板栗]",
    baseline: { unit: "g", quantity: 100, nutrients: [188, 4.2, 0.7, 42.2, 1.7, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 220, isoleucine: 157, methionine: 101, threonine: 167, leucine: 259, lysine: 228, phenylalanine: 190, tryptophan: 49, histidine: 121 },
      source: {
        name: "美国农业部 FoodData Central · Nuts, chestnuts, chinese, raw",
        version: "SR Legacy 2018-04", recordId: "170164",
        url: "https://fdc.nal.usda.gov/food-details/170164/nutrients",
      },
    },
  },
  {
    code: "071009", name: "栗子（干）[板栗]",
    baseline: { unit: "g", quantity: 100, nutrients: [348, 5.3, 1.7, 78.4, 1.2, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 358, isoleucine: 255, methionine: 165, threonine: 272, leucine: 421, lysine: 371, phenylalanine: 309, tryptophan: 80, histidine: 197 },
      source: {
        name: "美国农业部 FoodData Central · Nuts, chestnuts, chinese, dried",
        version: "SR Legacy 2018-04", recordId: "170165",
        url: "https://fdc.nal.usda.gov/food-details/170165/nutrients",
      },
    },
  },
  {
    code: "071018", name: "杏仁（漂白后）",
    baseline: { unit: "g", quantity: 100, nutrients: [602, 21.9, 50.6, 19.9, 10.4, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 805, isoleucine: 696, methionine: 190, threonine: 682, leucine: 1479, lysine: 605, phenylalanine: 1156, tryptophan: 193, histidine: 596 },
      source: {
        name: "美国农业部 FoodData Central · Nuts, almonds, blanched",
        version: "SR Legacy 2018-04", recordId: "170568",
        url: "https://fdc.nal.usda.gov/food-details/170568/nutrients",
      },
    },
  },
  {
    code: "071020", name: "杏仁（烤干，不加盐）",
    baseline: { unit: "g", quantity: 100, nutrients: [617, 22.1, 52.8, 19.3, 11.8, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 848, isoleucine: 745, methionine: 155, threonine: 595, leucine: 1461, lysine: 563, phenylalanine: 1122, tryptophan: 209, histidine: 534 },
      source: {
        name: "美国农业部 FoodData Central · Nuts, almonds, dry roasted, without salt added",
        version: "SR Legacy 2018-04", recordId: "170158",
        url: "https://fdc.nal.usda.gov/food-details/170158/nutrients",
      },
    },
  },
  {
    code: "071021", name: "杏仁（烤干，加盐）",
    baseline: { unit: "g", quantity: 100, nutrients: [617, 22.1, 52.8, 19.3, 11.8, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 848, isoleucine: 745, methionine: 155, threonine: 595, leucine: 1461, lysine: 563, phenylalanine: 1122, tryptophan: 209, histidine: 534 },
      source: {
        name: "美国农业部 FoodData Central · Nuts, almonds, dry roasted, with salt added",
        version: "SR Legacy 2018-04", recordId: "168596",
        url: "https://fdc.nal.usda.gov/food-details/168596/nutrients",
      },
    },
  },
  {
    code: "071027", name: "栗子[板栗]",
    baseline: { unit: "g", quantity: 100, nutrients: [186, 4.4, 1.6, 39.6, 2, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 220, isoleucine: 157, methionine: 101, threonine: 167, leucine: 259, lysine: 228, phenylalanine: 190, tryptophan: 49, histidine: 121 },
      source: {
        name: "美国农业部 FoodData Central · Nuts, chestnuts, chinese, raw",
        version: "SR Legacy 2018-04", recordId: "170164",
        url: "https://fdc.nal.usda.gov/food-details/170164/nutrients",
      },
    },
  },
  {
    code: "072001", name: "胡麻子",
    baseline: { unit: "g", quantity: 100, nutrients: [450, 19.1, 30.7, 39.5, 30.2, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 1072, isoleucine: 896, methionine: 370, threonine: 766, leucine: 1235, lysine: 862, phenylalanine: 957, tryptophan: 297, histidine: 472 },
      source: {
        name: "美国农业部 FoodData Central · Seeds, flaxseed",
        version: "SR Legacy 2018-04", recordId: "169414",
        url: "https://fdc.nal.usda.gov/food-details/169414/nutrients",
      },
    },
  },
  {
    code: "072004", name: "花生仁（生）",
    baseline: { unit: "g", quantity: 100, nutrients: [574, 24.8, 44.3, 21.7, 5.5, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 1082, isoleucine: 907, methionine: 317, threonine: 883, leucine: 1672, lysine: 926, phenylalanine: 1377, tryptophan: 250, histidine: 652 },
      source: {
        name: "美国农业部 FoodData Central · Peanuts, all types, raw",
        version: "SR Legacy 2018-04", recordId: "172430",
        url: "https://fdc.nal.usda.gov/food-details/172430/nutrients",
      },
    },
  },
  {
    code: "072009", name: "莲子（干）",
    baseline: { unit: "g", quantity: 100, nutrients: [350, 17.2, 2, 67.2, 3, 0] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 991, isoleucine: 765, methionine: 267, threonine: 747, leucine: 1215, lysine: 985, phenylalanine: 767, tryptophan: 221, histidine: 430 },
      source: {
        name: "美国农业部 FoodData Central · Seeds, lotus seeds, dried",
        version: "SR Legacy 2018-04", recordId: "170149",
        url: "https://fdc.nal.usda.gov/food-details/170149/nutrients",
      },
    },
  },
  {
    code: "081113", name: "猪大肠",
    baseline: { unit: "g", quantity: 100, nutrients: [196, 6.9, 18.7, 0, 0, 116.3] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 379, isoleucine: 303, methionine: 214, threonine: 365, leucine: 641, lysine: 561, phenylalanine: 284, tryptophan: 94, histidine: 190 },
      source: {
        name: "台湾食药署食品营养成分资料集 · 豬大腸",
        version: "2026-10-05-755d2f0e4a7c", recordId: "I0321801",
        url: "https://data.gov.tw/dataset/8543",
      },
    },
  },
  {
    code: "081115", name: "猪耳",
    baseline: { unit: "g", quantity: 100, nutrients: [176, 19.1, 11.1, 0, 0, 68.2] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 668, isoleucine: 421, methionine: 248, threonine: 515, leucine: 993, lysine: 970, phenylalanine: 585, tryptophan: 42, histidine: 258 },
      source: {
        name: "台湾食药署食品营养成分资料集 · 豬耳",
        version: "2026-10-05-755d2f0e4a7c", recordId: "I0320401",
        url: "https://data.gov.tw/dataset/8543",
      },
    },
  },
  {
    code: "081130", name: "猪皮",
    baseline: { unit: "g", quantity: 100, nutrients: [363, 27.4, 28.1, 0, 0, 72.4] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 703, isoleucine: 400, methionine: 275, threonine: 526, leucine: 939, lysine: 1050, phenylalanine: 614, tryptophan: 24, histidine: 241 },
      source: {
        name: "台湾食药署食品营养成分资料集 · 豬皮",
        version: "2026-10-05-755d2f0e4a7c", recordId: "I0320301",
        url: "https://data.gov.tw/dataset/8543",
      },
    },
  },
  {
    code: "081202", name: "猪肚",
    baseline: { unit: "g", quantity: 100, nutrients: [110, 15.2, 5.1, 0.7, 0, 75.1] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 538, isoleucine: 450, methionine: 294, threonine: 504, leucine: 897, lysine: 731, phenylalanine: 469, tryptophan: 89, histidine: 248 },
      source: {
        name: "台湾食药署食品营养成分资料集 · 豬肚",
        version: "2026-10-05-755d2f0e4a7c", recordId: "I0321101",
        url: "https://data.gov.tw/dataset/8543",
      },
    },
  },
  {
    code: "081203", name: "猪肺",
    baseline: { unit: "g", quantity: 100, nutrients: [84, 12.2, 3.9, 0.1, 0, 81.4] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 838, isoleucine: 563, methionine: 228, threonine: 496, leucine: 1093, lysine: 1027, phenylalanine: 586, tryptophan: 124, histidine: 356 },
      source: {
        name: "美国农业部 FoodData Central · Pork, fresh, variety meats and by-products, lungs, raw",
        version: "SR Legacy 2018-04", recordId: "167864",
        url: "https://fdc.nal.usda.gov/food-details/167864/nutrients",
      },
    },
  },
  {
    code: "081204", name: "猪肝",
    baseline: { unit: "g", quantity: 100, nutrients: [129, 19.3, 3.5, 5, 0, 68.6] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 1321, isoleucine: 1085, methionine: 530, threonine: 910, leucine: 1906, lysine: 1649, phenylalanine: 1047, tryptophan: 301, histidine: 582 },
      source: {
        name: "美国农业部 FoodData Central · Pork, fresh, variety meats and by-products, liver, raw",
        version: "SR Legacy 2018-04", recordId: "167862",
        url: "https://fdc.nal.usda.gov/food-details/167862/nutrients",
      },
    },
  },
  {
    code: "081205", name: "猪脑",
    baseline: { unit: "g", quantity: 100, nutrients: [131, 10.8, 9.8, 0, 0, 130.7] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 586, isoleucine: 475, methionine: 204, threonine: 480, leucine: 896, lysine: 808, phenylalanine: 523, tryptophan: 132, histidine: 276 },
      source: {
        name: "美国农业部 FoodData Central · Pork, fresh, variety meats and by-products, brain, raw",
        version: "SR Legacy 2018-04", recordId: "168264",
        url: "https://fdc.nal.usda.gov/food-details/168264/nutrients",
      },
    },
  },
  {
    code: "081206", name: "猪脾",
    baseline: { unit: "g", quantity: 100, nutrients: [94, 13.2, 3.2, 3.1, 0, 26.1] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 971, isoleucine: 797, methionine: 331, threonine: 714, leucine: 1460, lysine: 1334, phenylalanine: 763, tryptophan: 183, histidine: 426 },
      source: {
        name: "美国农业部 FoodData Central · Pork, fresh, variety meats and by-products, spleen, raw",
        version: "SR Legacy 2018-04", recordId: "167865",
        url: "https://fdc.nal.usda.gov/food-details/167865/nutrients",
      },
    },
  },
  {
    code: "081207", name: "猪舌[口条]",
    baseline: { unit: "g", quantity: 100, nutrients: [233, 15.7, 18.1, 1.7, 0, 79.4] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 848, isoleucine: 743, methionine: 365, threonine: 689, leucine: 1307, lysine: 1333, phenylalanine: 675, tryptophan: 188, histidine: 409 },
      source: {
        name: "美国农业部 FoodData Central · Pork, fresh, variety meats and by-products, tongue, raw",
        version: "SR Legacy 2018-04", recordId: "168275",
        url: "https://fdc.nal.usda.gov/food-details/168275/nutrients",
      },
    },
  },
  {
    code: "081208", name: "猪肾[猪腰子]",
    baseline: { unit: "g", quantity: 100, nutrients: [96, 15.4, 3.2, 1.4, 0, 134.2] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 948, isoleucine: 879, methionine: 353, threonine: 682, leucine: 1477, lysine: 1185, phenylalanine: 777, tryptophan: 213, histidine: 395 },
      source: {
        name: "美国农业部 FoodData Central · Pork, fresh, variety meats and by-products, kidneys, raw",
        version: "SR Legacy 2018-04", recordId: "168270",
        url: "https://fdc.nal.usda.gov/food-details/168270/nutrients",
      },
    },
  },
  {
    code: "081209", name: "猪肾（腰子）",
    baseline: { unit: "g", quantity: 100, nutrients: [137, 16, 8.1, 0, 0, 124.8] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 948, isoleucine: 879, methionine: 353, threonine: 682, leucine: 1477, lysine: 1185, phenylalanine: 777, tryptophan: 213, histidine: 395 },
      source: {
        name: "美国农业部 FoodData Central · Pork, fresh, variety meats and by-products, kidneys, raw",
        version: "SR Legacy 2018-04", recordId: "168270",
        url: "https://fdc.nal.usda.gov/food-details/168270/nutrients",
      },
    },
  },
  {
    code: "081210", name: "猪小肠",
    baseline: { unit: "g", quantity: 100, nutrients: [65, 10, 2, 1.7, 0, 204.8] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 568, isoleucine: 454, methionine: 262, threonine: 536, leucine: 964, lysine: 845, phenylalanine: 464, tryptophan: 128, histidine: 274 },
      source: {
        name: "台湾食药署食品营养成分资料集 · 豬小腸",
        version: "2026-10-05-755d2f0e4a7c", recordId: "I0321901",
        url: "https://data.gov.tw/dataset/8543",
      },
    },
  },
  {
    code: "081211", name: "猪心",
    baseline: { unit: "g", quantity: 100, nutrients: [119, 16.6, 5.3, 1.1, 0, 71.2] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 914, isoleucine: 831, methionine: 442, threonine: 757, leucine: 1558, lysine: 1428, phenylalanine: 762, tryptophan: 199, histidine: 439 },
      source: {
        name: "美国农业部 FoodData Central · Pork, fresh, variety meats and by-products, heart, raw",
        version: "SR Legacy 2018-04", recordId: "168267",
        url: "https://fdc.nal.usda.gov/food-details/168267/nutrients",
      },
    },
  },
  {
    code: "082204", name: "牛肺",
    baseline: { unit: "g", quantity: 100, nutrients: [95, 16.5, 2.5, 1.5, 0, 154.8] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 798, isoleucine: 772, methionine: 324, threonine: 604, leucine: 1190, lysine: 1148, phenylalanine: 658, tryptophan: 148, histidine: 492 },
      source: {
        name: "美国农业部 FoodData Central · Beef, variety meats and by-products, lungs, raw",
        version: "SR Legacy 2018-04", recordId: "168628",
        url: "https://fdc.nal.usda.gov/food-details/168628/nutrients",
      },
    },
  },
  {
    code: "082205", name: "牛肝",
    baseline: { unit: "g", quantity: 100, nutrients: [139, 19.8, 3.9, 6.2, 0, 45] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 1260, isoleucine: 967, methionine: 543, threonine: 869, leucine: 1910, lysine: 1607, phenylalanine: 1084, tryptophan: 263, histidine: 629 },
      source: {
        name: "美国农业部 FoodData Central · Beef, variety meats and by-products, liver, raw",
        version: "SR Legacy 2018-04", recordId: "169451",
        url: "https://fdc.nal.usda.gov/food-details/169451/nutrients",
      },
    },
  },
  {
    code: "082207", name: "牛舌",
    baseline: { unit: "g", quantity: 100, nutrients: [196, 17, 13.3, 2, 0, 58.4] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 713, isoleucine: 641, methionine: 315, threonine: 648, leucine: 1113, lysine: 1149, phenylalanine: 615, tryptophan: 114, histidine: 386 },
      source: {
        name: "美国农业部 FoodData Central · Beef, variety meats and by-products, tongue, raw",
        version: "SR Legacy 2018-04", recordId: "170196",
        url: "https://fdc.nal.usda.gov/food-details/170196/nutrients",
      },
    },
  },
  {
    code: "085101", name: "马肉",
    baseline: { unit: "g", quantity: 100, nutrients: [122, 20.1, 4.6, 0.1, 0, 115.8] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 1108, isoleucine: 1014, methionine: 473, threonine: 959, leucine: 1696, lysine: 1823, phenylalanine: 879, tryptophan: 265, histidine: 822 },
      source: {
        name: "美国农业部 FoodData Central · Game meat, horse, raw",
        version: "SR Legacy 2018-04", recordId: "175086",
        url: "https://fdc.nal.usda.gov/food-details/175086/nutrients",
      },
    },
  },
  {
    code: "089004", name: "兔肉",
    baseline: { unit: "g", quantity: 100, nutrients: [102, 19.7, 2.2, 0.9, 0, 45.1] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 1019, isoleucine: 951, methionine: 502, threonine: 897, leucine: 1562, lysine: 1756, phenylalanine: 823, tryptophan: 265, histidine: 562 },
      source: {
        name: "美国农业部 FoodData Central · Game meat, rabbit, domesticated, composite of cuts, raw",
        version: "SR Legacy 2018-04", recordId: "172521",
        url: "https://fdc.nal.usda.gov/food-details/172521/nutrients",
      },
    },
  },
  {
    code: "089005", name: "兔肉（野）",
    baseline: { unit: "g", quantity: 100, nutrients: [84, 16.6, 2, 0, 0, 88.3] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 1108, isoleucine: 1034, methionine: 545, threonine: 975, leucine: 1698, lysine: 1908, phenylalanine: 895, tryptophan: 288, histidine: 611 },
      source: {
        name: "美国农业部 FoodData Central · Game meat, rabbit, wild, raw",
        version: "SR Legacy 2018-04", recordId: "174347",
        url: "https://fdc.nal.usda.gov/food-details/174347/nutrients",
      },
    },
  },
  {
    code: "091201", name: "鸡肝",
    baseline: { unit: "g", quantity: 100, nutrients: [121, 16.6, 4.8, 2.8, 0, 92] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 998, isoleucine: 813, methionine: 432, threonine: 725, leucine: 1512, lysine: 1332, phenylalanine: 824, tryptophan: 176, histidine: 507 },
      source: {
        name: "美国农业部 FoodData Central · Chicken, liver, all classes, raw",
        version: "SR Legacy 2018-04", recordId: "171060",
        url: "https://fdc.nal.usda.gov/food-details/171060/nutrients",
      },
    },
  },
  {
    code: "091202", name: "鸡肝（肉鸡）",
    baseline: { unit: "g", quantity: 100, nutrients: [121, 16.7, 4.5, 3.5, 0, 98.2] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 837, isoleucine: 673, methionine: 382, threonine: 714, leucine: 1364, lysine: 1155, phenylalanine: 724, tryptophan: 144, histidine: 415 },
      source: {
        name: "台湾食药署食品营养成分资料集 · 雞肝(肉雞)",
        version: "2026-10-05-755d2f0e4a7c", recordId: "I0420301",
        url: "https://data.gov.tw/dataset/8543",
      },
    },
  },
  {
    code: "091203", name: "鸡心",
    baseline: { unit: "g", quantity: 100, nutrients: [172, 15.9, 11.8, 0.6, 0, 108.4] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 880, isoleucine: 833, methionine: 376, threonine: 704, leucine: 1355, lysine: 1303, phenylalanine: 696, tryptophan: 199, histidine: 408 },
      source: {
        name: "美国农业部 FoodData Central · Chicken, heart, all classes, raw",
        version: "SR Legacy 2018-04", recordId: "171458",
        url: "https://fdc.nal.usda.gov/food-details/171458/nutrients",
      },
    },
  },
  {
    code: "092201", name: "鸭肠",
    baseline: { unit: "g", quantity: 100, nutrients: [129, 14.2, 7.8, 0.4, 0, 32] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 615, isoleucine: 568, methionine: 300, threonine: 557, leucine: 1017, lysine: 952, phenylalanine: 527, histidine: 491 },
      source: {
        name: "台湾食药署食品营养成分资料集 · 鴨腸",
        version: "2026-10-05-755d2f0e4a7c", recordId: "I0520401",
        url: "https://data.gov.tw/dataset/8543",
      },
    },
  },
  {
    code: "092202", name: "鸭肝",
    baseline: { unit: "g", quantity: 100, nutrients: [128, 14.5, 7.5, 0.5, 0, 87.2] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 1181, isoleucine: 995, methionine: 444, threonine: 833, leucine: 1691, lysine: 1418, phenylalanine: 932, tryptophan: 264, histidine: 498 },
      source: {
        name: "美国农业部 FoodData Central · Duck, domesticated, liver, raw",
        version: "SR Legacy 2018-04", recordId: "174467",
        url: "https://fdc.nal.usda.gov/food-details/174467/nutrients",
      },
    },
  },
  {
    code: "093201", name: "鹅肝",
    baseline: { unit: "g", quantity: 100, nutrients: [129, 15.2, 3.4, 9.3, 0, 70.2] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 1032, isoleucine: 870, methionine: 388, threonine: 728, leucine: 1477, lysine: 1239, phenylalanine: 815, tryptophan: 230, histidine: 435 },
      source: {
        name: "美国农业部 FoodData Central · Goose, liver, raw",
        version: "SR Legacy 2018-04", recordId: "172415",
        url: "https://fdc.nal.usda.gov/food-details/172415/nutrients",
      },
    },
  },
  {
    code: "094201", name: "火鸡肝",
    baseline: { unit: "g", quantity: 100, nutrients: [143, 20, 5.6, 3.1, 0, 128.6] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 643, isoleucine: 519, methionine: 461, threonine: 660, leucine: 1310, lysine: 1378, phenylalanine: 672, tryptophan: 199, histidine: 398 },
      source: {
        name: "美国农业部 FoodData Central · Turkey, all classes, liver, raw",
        version: "SR Legacy 2018-04", recordId: "171486",
        url: "https://fdc.nal.usda.gov/food-details/171486/nutrients",
      },
    },
  },
  {
    code: "094202", name: "火鸡肫",
    baseline: { unit: "g", quantity: 100, nutrients: [91, 18.9, 0.3, 3.2, 0, 57] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 674, isoleucine: 544, methionine: 483, threonine: 692, leucine: 1373, lysine: 1444, phenylalanine: 704, tryptophan: 208, histidine: 418 },
      source: {
        name: "美国农业部 FoodData Central · Turkey, gizzard, all classes, raw",
        version: "SR Legacy 2018-04", recordId: "171085",
        url: "https://fdc.nal.usda.gov/food-details/171085/nutrients",
      },
    },
  },
  {
    code: "101101", name: "纯牛奶（代表值，全脂）",
    baseline: { unit: "g", quantity: 100, nutrients: [65, 3.3, 3.6, 4.9, 0, 63.7] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 206, isoleucine: 163, methionine: 83, threonine: 134, leucine: 299, lysine: 264, phenylalanine: 163, tryptophan: 40, histidine: 95 },
      source: {
        name: "美国农业部 FoodData Central · Milk, whole, 3.25% milkfat, without added vitamin A and vitamin D",
        version: "SR Legacy 2018-04", recordId: "172217",
        url: "https://fdc.nal.usda.gov/food-details/172217/nutrients",
      },
    },
  },
  {
    code: "101161", name: "纯牛奶（代表值，脱脂）",
    baseline: { unit: "g", quantity: 100, nutrients: [34, 3.5, 0.3, 4.6, 0, 127.3] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 221, isoleucine: 174, methionine: 88, threonine: 144, leucine: 319, lysine: 282, phenylalanine: 175, tryptophan: 43, histidine: 102 },
      source: {
        name: "美国农业部 FoodData Central · Milk, nonfat, fluid, without added vitamin A and vitamin D (fat free or skim)",
        version: "SR Legacy 2018-04", recordId: "173432",
        url: "https://fdc.nal.usda.gov/food-details/173432/nutrients",
      },
    },
  },
  {
    code: "101187", name: "鲜牛奶（代表值，全脂）",
    baseline: { unit: "g", quantity: 100, nutrients: [67, 3.4, 3.7, 5.1, 0, 120.3] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 206, isoleucine: 163, methionine: 83, threonine: 134, leucine: 299, lysine: 264, phenylalanine: 163, tryptophan: 40, histidine: 95 },
      source: {
        name: "美国农业部 FoodData Central · Milk, whole, 3.25% milkfat, without added vitamin A and vitamin D",
        version: "SR Legacy 2018-04", recordId: "172217",
        url: "https://fdc.nal.usda.gov/food-details/172217/nutrients",
      },
    },
  },
  {
    code: "102103", name: "全脂奶粉",
    baseline: { unit: "g", quantity: 100, nutrients: [478, 20.1, 21.2, 51.7, 0, 260.1] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 1762, isoleucine: 1592, methionine: 660, threonine: 1188, leucine: 2578, lysine: 2087, phenylalanine: 1271, tryptophan: 371, histidine: 714 },
      source: {
        name: "美国农业部 FoodData Central · Milk, dry, whole, without added vitamin D",
        version: "SR Legacy 2018-04", recordId: "173454",
        url: "https://fdc.nal.usda.gov/food-details/173454/nutrients",
      },
    },
  },
  {
    code: "104005", name: "奶酪（契达干酪，普通）",
    baseline: { unit: "g", quantity: 100, nutrients: [412, 25.5, 34.4, 0.1, 0, 670] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 1404, isoleucine: 1206, methionine: 547, threonine: 1044, leucine: 1939, lysine: 1025, phenylalanine: 1074, tryptophan: 547, histidine: 547 },
      source: {
        name: "美国农业部 FoodData Central · Cheese, cheddar (Includes foods for USDA's Food Distribution Program)",
        version: "SR Legacy 2018-04", recordId: "173414",
        url: "https://fdc.nal.usda.gov/food-details/173414/nutrients",
      },
    },
  },
  {
    code: "109001", name: "炼乳（甜，罐头）",
    baseline: { unit: "g", quantity: 100, nutrients: [332, 8, 8.7, 55.4, 0, 211.9] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 529, isoleucine: 479, methionine: 198, threonine: 357, leucine: 775, lysine: 627, phenylalanine: 382, tryptophan: 112, histidine: 214 },
      source: {
        name: "美国农业部 FoodData Central · Milk, canned, condensed, sweetened",
        version: "SR Legacy 2018-04", recordId: "171275",
        url: "https://fdc.nal.usda.gov/food-details/171275/nutrients",
      },
    },
  },
  {
    code: "111101", name: "鸡蛋（代表值）",
    baseline: { unit: "g", quantity: 100, nutrients: [139, 13.1, 8.6, 2.4, 0, 131.5] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 858, isoleucine: 671, methionine: 380, threonine: 556, leucine: 1086, lysine: 912, phenylalanine: 680, tryptophan: 167, histidine: 309 },
      source: {
        name: "美国农业部 FoodData Central · Egg, whole, raw, fresh",
        version: "SR Legacy 2018-04", recordId: "171287",
        url: "https://fdc.nal.usda.gov/food-details/171287/nutrients",
      },
    },
  },
  {
    code: "111105", name: "鸡蛋白",
    baseline: { unit: "g", quantity: 100, nutrients: [60, 11.6, 0.1, 3.1, 0, 79.4] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 809, isoleucine: 661, methionine: 399, threonine: 449, leucine: 1016, lysine: 806, phenylalanine: 686, tryptophan: 125, histidine: 290 },
      source: {
        name: "美国农业部 FoodData Central · Egg, white, raw, fresh",
        version: "SR Legacy 2018-04", recordId: "172183",
        url: "https://fdc.nal.usda.gov/food-details/172183/nutrients",
      },
    },
  },
  {
    code: "111107", name: "鸡蛋黄",
    baseline: { unit: "g", quantity: 100, nutrients: [328, 15.2, 28.2, 3.4, 0, 54.9] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 949, isoleucine: 866, methionine: 378, threonine: 687, leucine: 1399, lysine: 1217, phenylalanine: 681, tryptophan: 177, histidine: 416 },
      source: {
        name: "美国农业部 FoodData Central · Egg, yolk, raw, fresh",
        version: "SR Legacy 2018-04", recordId: "172184",
        url: "https://fdc.nal.usda.gov/food-details/172184/nutrients",
      },
    },
  },
  {
    code: "111201", name: "鸡蛋粉[全蛋粉]",
    baseline: { unit: "g", quantity: 100, nutrients: [545, 43.4, 36.2, 11.3, 0, 393.2] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 2991, isoleucine: 2434, methionine: 1495, threonine: 2129, leucine: 4150, lysine: 3339, phenylalanine: 2530, tryptophan: 775, histidine: 1202 },
      source: {
        name: "美国农业部 FoodData Central · Egg, whole, dried",
        version: "SR Legacy 2018-04", recordId: "172188",
        url: "https://fdc.nal.usda.gov/food-details/172188/nutrients",
      },
    },
  },
  {
    code: "111202", name: "鸡蛋黄粉",
    baseline: { unit: "g", quantity: 100, nutrients: [644, 31.6, 55.1, 5.3, 0, 89.8] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 1934, isoleucine: 1701, methionine: 858, threonine: 1545, leucine: 2908, lysine: 2469, phenylalanine: 1472, tryptophan: 390, histidine: 861 },
      source: {
        name: "美国农业部 FoodData Central · Egg, yolk, dried",
        version: "SR Legacy 2018-04", recordId: "173428",
        url: "https://fdc.nal.usda.gov/food-details/173428/nutrients",
      },
    },
  },
  {
    code: "111204", name: "鸡蛋（煮）",
    baseline: { unit: "g", quantity: 100, nutrients: [143, 12.1, 10.5, 0.1, 0, 130] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 767, isoleucine: 686, methionine: 392, threonine: 604, leucine: 1075, lysine: 904, phenylalanine: 668, tryptophan: 153, histidine: 298 },
      source: {
        name: "美国农业部 FoodData Central · Egg, whole, cooked, hard-boiled",
        version: "SR Legacy 2018-04", recordId: "173424",
        url: "https://fdc.nal.usda.gov/food-details/173424/nutrients",
      },
    },
  },
  {
    code: "111206", name: "荷包蛋（油煎）",
    baseline: { unit: "g", quantity: 100, nutrients: [195, 13.5, 15, 1.4, 0, 353] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 930, isoleucine: 728, methionine: 411, threonine: 602, leucine: 1177, lysine: 989, phenylalanine: 736, tryptophan: 181, histidine: 335 },
      source: {
        name: "美国农业部 FoodData Central · Egg, whole, cooked, fried",
        version: "SR Legacy 2018-04", recordId: "173423",
        url: "https://fdc.nal.usda.gov/food-details/173423/nutrients",
      },
    },
  },
  {
    code: "111207", name: "荷包蛋（煮）",
    baseline: { unit: "g", quantity: 100, nutrients: [155, 12.3, 11.7, 0.2, 0, 110] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 855, isoleucine: 669, methionine: 378, threonine: 553, leucine: 1082, lysine: 909, phenylalanine: 677, tryptophan: 166, histidine: 308 },
      source: {
        name: "美国农业部 FoodData Central · Egg, whole, cooked, poached",
        version: "SR Legacy 2018-04", recordId: "172186",
        url: "https://fdc.nal.usda.gov/food-details/172186/nutrients",
      },
    },
  },
  {
    code: "112101", name: "鸭蛋",
    baseline: { unit: "g", quantity: 100, nutrients: [180, 12.6, 13, 3.1, 0, 106] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 885, isoleucine: 598, methionine: 576, threonine: 736, leucine: 1097, lysine: 951, phenylalanine: 840, tryptophan: 260, histidine: 320 },
      source: {
        name: "美国农业部 FoodData Central · Egg, duck, whole, fresh, raw",
        version: "SR Legacy 2018-04", recordId: "172189",
        url: "https://fdc.nal.usda.gov/food-details/172189/nutrients",
      },
    },
  },
  {
    code: "112102", name: "鸭蛋白",
    baseline: { unit: "g", quantity: 100, nutrients: [47, 9.9, 0, 1.8, 0, 71.2] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 691, isoleucine: 489, methionine: 705, threonine: 675, leucine: 892, lysine: 784, phenylalanine: 828, tryptophan: 110, histidine: 276 },
      source: {
        name: "台湾食药署食品营养成分资料集 · 鴨蛋白",
        version: "2026-10-05-755d2f0e4a7c", recordId: "K0206101",
        url: "https://data.gov.tw/dataset/8543",
      },
    },
  },
  {
    code: "112103", name: "鸭蛋黄",
    baseline: { unit: "g", quantity: 100, nutrients: [378, 14.5, 33.8, 4, 0, 30.1] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 817, isoleucine: 764, methionine: 118, threonine: 809, leucine: 1302, lysine: 1202, phenylalanine: 700, tryptophan: 248, histidine: 448 },
      source: {
        name: "台湾食药署食品营养成分资料集 · 鴨蛋黃",
        version: "2026-10-05-755d2f0e4a7c", recordId: "K0208101",
        url: "https://data.gov.tw/dataset/8543",
      },
    },
  },
  {
    code: "113101", name: "鹅蛋",
    baseline: { unit: "g", quantity: 100, nutrients: [196, 11.1, 15.6, 2.8, 0, 90.6] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 958, isoleucine: 647, methionine: 624, threonine: 797, leucine: 1188, lysine: 1030, phenylalanine: 910, tryptophan: 282, histidine: 346 },
      source: {
        name: "美国农业部 FoodData Central · Egg, goose, whole, fresh, raw",
        version: "SR Legacy 2018-04", recordId: "172190",
        url: "https://fdc.nal.usda.gov/food-details/172190/nutrients",
      },
    },
  },
  {
    code: "114101", name: "鹌鹑蛋",
    baseline: { unit: "g", quantity: 100, nutrients: [160, 12.8, 11.1, 2.1, 0, 106.6] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 712, isoleucine: 583, methionine: 404, threonine: 686, leucine: 1096, lysine: 954, phenylalanine: 640, tryptophan: 191, histidine: 484 },
      source: {
        name: "台湾食药署食品营养成分资料集 · 鵪鶉蛋",
        version: "2026-10-05-755d2f0e4a7c", recordId: "K0300101",
        url: "https://data.gov.tw/dataset/8543",
      },
    },
  },
  {
    code: "121111", name: "鲤鱼[鲤拐子]",
    baseline: { unit: "g", quantity: 100, nutrients: [109, 17.6, 4.1, 0.5, 0, 53.7] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 919, isoleucine: 822, methionine: 528, threonine: 782, leucine: 1449, lysine: 1638, phenylalanine: 696, tryptophan: 200, histidine: 525 },
      source: {
        name: "美国农业部 FoodData Central · Fish, carp, raw",
        version: "SR Legacy 2018-04", recordId: "171952",
        url: "https://fdc.nal.usda.gov/food-details/171952/nutrients",
      },
    },
  },
  {
    code: "121112", name: "罗非鱼",
    baseline: { unit: "g", quantity: 100, nutrients: [98, 18.4, 1.5, 2.8, 0, 19.8] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 970, isoleucine: 930, methionine: 593, threonine: 950, leucine: 1603, lysine: 1810, phenylalanine: 810, tryptophan: 210, histidine: 470 },
      source: {
        name: "美国农业部 FoodData Central · Fish, tilapia, raw",
        version: "SR Legacy 2018-04", recordId: "175176",
        url: "https://fdc.nal.usda.gov/food-details/175176/nutrients",
      },
    },
  },
  {
    code: "121228", name: "鲑鱼[大麻哈鱼]",
    baseline: { unit: "g", quantity: 100, nutrients: [139, 17.2, 7.8, 0, 0, 63.3] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 1037, isoleucine: 928, methionine: 596, threonine: 883, leucine: 1637, lysine: 1849, phenylalanine: 786, tryptophan: 226, histidine: 593 },
      source: {
        name: "美国农业部 FoodData Central · Fish, salmon, chum, raw",
        version: "SR Legacy 2018-04", recordId: "173689",
        url: "https://fdc.nal.usda.gov/food-details/173689/nutrients",
      },
    },
  },
  {
    code: "121235", name: "鲻鱼[白眼棱鱼]",
    baseline: { unit: "g", quantity: 100, nutrients: [119, 18.9, 4.8, 0, 0, 71.4] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 997, isoleucine: 892, methionine: 573, threonine: 848, leucine: 1573, lysine: 1777, phenylalanine: 755, tryptophan: 217, histidine: 570 },
      source: {
        name: "美国农业部 FoodData Central · Fish, mullet, striped, raw",
        version: "SR Legacy 2018-04", recordId: "175123",
        url: "https://fdc.nal.usda.gov/food-details/175123/nutrients",
      },
    },
  },
  {
    code: "122115", name: "虾皮",
    baseline: { unit: "g", quantity: 100, nutrients: [153, 30.7, 2.2, 2.5, 0, 5057.7] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 1286, isoleucine: 1252, methionine: 1599, threonine: 1122, leucine: 2137, lysine: 2176, phenylalanine: 1331, tryptophan: 248, histidine: 606 },
      source: {
        name: "台湾食药署食品营养成分资料集 · 蝦皮",
        version: "2026-10-05-755d2f0e4a7c", recordId: "J2300101",
        url: "https://data.gov.tw/dataset/8543",
      },
    },
  },
  {
    code: "181006", name: "蜂蜜",
    baseline: { unit: "g", quantity: 100, nutrients: [321, 0.4, 1.9, 75.6, 0, 0.3] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 9, isoleucine: 8, methionine: 1, threonine: 4, leucine: 10, lysine: 8, phenylalanine: 11, tryptophan: 4, histidine: 1 },
      source: {
        name: "美国农业部 FoodData Central · Honey",
        version: "SR Legacy 2018-04", recordId: "169640",
        url: "https://fdc.nal.usda.gov/food-details/169640/nutrients",
      },
    },
  },
  {
    code: "206010", name: "茴香籽[小茴香籽]",
    baseline: { unit: "g", quantity: 100, nutrients: [318, 14.5, 11.8, 55.5, 33.9, 79.6] },
    profile: {
      basis: "g", estimated: true,
      values: { valine: 915, isoleucine: 695, methionine: 301, threonine: 602, leucine: 996, lysine: 758, phenylalanine: 647, tryptophan: 253, histidine: 331 },
      source: {
        name: "美国农业部 FoodData Central · Spices, fennel seed",
        version: "SR Legacy 2018-04", recordId: "171323",
        url: "https://fdc.nal.usda.gov/food-details/171323/nutrients",
      },
    },
  },
]
