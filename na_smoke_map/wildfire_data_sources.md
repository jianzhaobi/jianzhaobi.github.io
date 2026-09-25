# 美国"值得关注的野火"信息源调研

> 调研日期：2026-07-24。背景：美国每年有数万起野火（2026 年截至 7 月已约 4.1 万起、过火 390 万英亩，国家戒备等级 PL5），但绝大多数是小火，需要一套标准和数据源来筛选出真正值得关注的火情。

## 1. 官方如何界定"值得关注的火"

联邦跨机构系统有现成的筛选标准，可直接借用：

| 信号 | 定义 / 门槛 | 数据出处 |
|---|---|---|
| **大火（Large Fire）** | 林地燃料 > 100 英亩，或草地燃料 > 300 英亩，或有事件管理团队（IMT）进驻 | NIFC IMSR、ICS-209 |
| **国家戒备等级（PL1–PL5）** | 全国火情紧张程度；PL5 为最高级（2026-07 当前即为 PL5） | NIFC |
| **人的影响** | 疏散令、受威胁/损毁建筑数、伤亡 | ICS-209 / WFIGS 属性字段 |
| **管理级别** | Type 1 / Type 2 IMT 进驻 = 官方认定的复杂火情 | IMSR、InciWeb |
| **烟雾影响** | 烟羽覆盖人口密集区、PM2.5 超标 | NOAA HMS、AirNow |
| **趋势** | 控制率低 + 面积快速增长，比大而稳定的火更危险 | WFIGS 时间序列 |

## 2. 官方权威数据源（每日情报）

| 来源 | 内容 | 更新频率 | 适合用途 |
|---|---|---|---|
| [NIFC IMSR 每日态势报告](https://www.nifc.gov/nicc-files/sitreprt.pdf) | 全国大火逐一列表：面积、控制率、资源投入、受威胁建筑，按地理区（GACC）分组 | 火季每日 0730 MDT；冬季每周 | **判断哪些火"重要"的黄金标准** |
| [NIFC Fire Information](https://www.nifc.gov/fire-information) | 全国统计、戒备等级、当前形势 | 每日 | 宏观态势 |
| [InciWeb](https://inciweb.wildfire.gov/) | 每起重大事件的官方页面：疏散、封闭、地图、新闻稿 | 事件人员实时更新 | 单个火情的权威详情（媒体报道的源头） |
| [Understanding the IMSR](https://www.nifc.gov/sites/default/files/NICC/1-Incident%20Information/IMSR/Understanding%20the%20IMSR%202025.pdf) | IMSR 各字段的官方解释文档 | — | 理解报告口径 |

## 3. 结构化数据 / API（适合程序接入）

| 来源 | 内容 | 特点 |
|---|---|---|
| **WFIGS**（Wildland Fire Interagency Geospatial Services，ArcGIS REST API） | 跨机构统一的火点/火界，含 `IncidentSize`、`PercentContained`、疏散、建筑威胁等 ICS-209 字段 | na_smoke_map 已在用；**用属性字段做重要性过滤最顺手** |
| [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/usfs/map/)（[Earthdata 介绍](https://www.earthdata.nasa.gov/data/tools/firms)） | MODIS/VIIRS 卫星热点，美加近实时（部分实时），有 API 和 GIS 服务 | 最快、无遗漏；但不区分野火与农业烧荒，需与 WFIGS 事件关联 |
| **NOAA HMS**（Hazard Mapping System） | 人工分析的烟羽范围图 | 烟雾地图类应用的标准数据源 |
| [NOAA HRRR-Smoke](https://rapidrefresh.noaa.gov/hrrr/HRRRsmoke/) | 未来 48 小时烟雾传输预报模型 | 预报维度 |
| [AirNow Fire and Smoke Map](https://fire.airnow.gov/)（[说明](https://www.airnow.gov/fasm-info/)） | 地面 PM2.5 监测 + 火点 + 烟羽（EPA + 林务局 IWFAQRP 合作），有公开 API | 从"对人的影响"角度筛选最直接 |

## 4. 新闻与实时追踪（面向公众）

| 来源 | 说明 |
|---|---|
| [Watch Duty](https://www.watchduty.org/) | 非营利，志愿者（多为退役消防员）监听无线电人工核实，覆盖西部各州。**目前公认最快、信噪比最高的野火警报来源** |
| [CAL FIRE](https://www.fire.ca.gov/) | 加州州属官方火情页面，加州火情比 InciWeb 更快 |
| 地方 NWS 办公室 / 红旗警告（Red Flag Warning） | 预判"接下来哪里会烧" |
| Wildfire Today、The Hotshot Wakeup | 行业深度分析：哪些火在消防圈内被认为是真正的威胁 |
| [2026 United States wildfires — Wikipedia](https://en.wikipedia.org/wiki/2026_United_States_wildfires) | 当年重大火情的汇总回顾 |

## 5. IMSR 与 WFIGS 的关系（数据管线）

两者上游共享同一套跨机构数据生态，枢纽是 **IRWIN**（Integrated Reporting of Wildland Fire Information）；它们是同一份填报数据的两种不同"出口"：

```
事件现场/调度中心
   ├─ ICS-209 表（大火逐日填报）──┐
   ├─ 调度 CAD 系统 ─────────────┤
   └─ WFDSS 等其他应用 ──────────┼──> IRWIN（数据交换枢纽，双向同步）
                                 │        │
        SIT/209 应用 <───────────┘        ├──> WFIGS（GIS 服务，程序可读）
             │
             └──> IMSR PDF（NICC 预测服务部人工汇编，每日发布）
```

- **IMSR**：SIT/209 应用中的数据（调度中心 Situation Report + 事件级 ICS-209），由 NICC 人工汇编为叙述性 PDF。
- **WFIGS**：基于 IRWIN 的地理空间服务；WFIGS 事件记录中的 ICS-209 衍生字段（面积、控制率、受威胁建筑等）与 IMSR 中的数字**本质是同一份填报数据**。NIFC 于 2026 年 1–2 月改进了 IRWIN、WFIGS、SIT-209 三者的同步。

### IMSR 事件与 WFIGS 记录的匹配

几乎都能对应上，但有几个坑：

| 坑 | 说明 |
|---|---|
| 无共享 ID | IMSR PDF 只印"名称 + 州-单位代码"（如 `Green Fire, CA-SHU`），不印 IrwinID；需靠 `IncidentName` + 州 + `POOProtectingAgency` 匹配，名称偶有差异 |
| Complex 一对多 | IMSR 按 Complex 列一行；WFIGS 可能是 Complex 一条 + 成员火各一条 |
| 时间差 | IMSR 是前一日快照（0730 MDT 发布），WFIGS 更新更频繁，数字常不一致 |
| 汇总行 | 低优先级火可能只以"某区另有 N 起大火"汇总，不逐一列出 |

### 结论（已实证核实，见下节）

**不需要解析 IMSR PDF**：WFIGS 覆盖了 IMSR 的全部事件，用 ICS-209 相关字段过滤即可近似复现 IMSR 大火列表。但过滤口径**不是**"面积 ≥ 100/300 英亩"，而应该用：

```
ICS209ReportDateTime IS NOT NULL      -- 有 209 填报（官方认定"值得报"）
AND ICS209ReportStatus = 'U'          -- 状态为 Update（活跃填报中，排除已结案的 F/Final）
AND PercentContained < 100            -- 未完全控制
```

IMSR 独有的价值：人工态势叙述、资源投入统计、GACC 汇总与戒备等级、**受威胁/损毁建筑数**（公开 WFIGS 点位层没有建筑字段）——适合人读，不适合喂地图。

### 实证核验（2026-07-24，IMSR 当日报告 vs WFIGS 实时 API）

用当日 IMSR（PL5，78 起未控大火，提取 77 条表格记录）与 WFIGS `Incident_Locations_Current/YearToDate` 逐条比对，结论：

**✅ 覆盖性成立：77/77 全部存在于 WFIGS**（73 起在 Current 视图，4 起当时只在 YearToDate 层——均为前一两天新立案、209 状态为 Initial 的火，Current 视图收录有延迟）。

**⚠️ 但有四个实际的坑，比文档此前预想的更具体：**

1. **名称匹配比预想难**：WFIGS 存的是调度系统原始名，IMSR 印的是清洗后的展示名。实测例子：IMSR "Brewer" = WFIGS `0433 BREWER`、"Claremont" = `RA 6 ADA CO CLAREMONT`、"E Evans Creek Rd" = `E Evans Creek Rd 18000`。且州字段不可靠（Fishhook 的单位是 WY-MRF 但 `POOState=US-CO`）。纯名称精确匹配只能命中 ~85%，需要子串/模糊匹配 + 用 `UniqueFireIdentifier`（年-单位-序号）兜底。
2. **数字并不总同步，且双向不一致**：Akawa Butte 当日 IMSR 26,144 英亩 vs WFIGS 5,000 英亩（WFIGS 滞后 5 倍）；0512 Box Springs 则相反，IMSR 报 15,203 英亩未控，WFIGS 已是 21,432 英亩、100% 控制、209 已结案（WFIGS 更新）。原因：IMSR 是前一日 0730 MDT 快照，WFIGS 持续同步。**"同一套数据"在管线意义上成立，但任一时刻两边数字可能差数倍。**
3. **面积门槛不是 IMSR 的实际收录标准**：IMSR 收录了 91 英亩的 Stone Creek、108 英亩的 Taylor Hollow、138 英亩的 Chute（均因有 IMT 或建筑威胁）；反向看，WFIGS 中 67 起 ≥300 英亩带 209 的火不在当日 IMSR——绝大多数是已控制/209 已结案、阿拉斯加监控类火情、或 IMSR 火的名称变体。真正的收录信号是 **"有活跃的 ICS-209 填报"**，不是面积。
4. **公开 WFIGS 点位层缺少建筑威胁字段**：字段列表里没有受威胁/损毁建筑数（IMSR 表格的 Strc Lost 列在公开层拿不到），"受威胁建筑 > 0"这个过滤条件在公开 API 上**不可用**。可用的替代信号：`TotalIncidentPersonnel`（投入人力）、`IncidentManagementOrganization`（IMT 类型）、`IncidentComplexityLevel`。

**另一个对烟雾地图有利的发现**：当日 IMSR 显示阿拉斯加（AICC）0 起事件，但 WFIGS 里有约 15 起阿拉斯加未控火带活跃 209（监控策略、不投入资源、IMSR 不列）——这些火照样产烟。**对烟雾用途，WFIGS + 209 过滤比 IMSR 更完整。**

参考：[IRWIN 数据交换说明（WFDSS Help）](https://wfdss.usgs.gov/wfdss_help/WFDSSHelp_abt_IRWIN_data_exchange.html)、[SIT-209 应用门户](https://www.wildfire.gov/application/sit209)、[ICS-209 用户指南](https://www.nifc.gov/sites/default/files/document-media/2023_ICS-209_User_Guide.pdf)、[WFIGS 事件位置数据集](https://data-nifc.opendata.arcgis.com/datasets/nifc::wildland-fire-incident-locations/about)、[IMSR 研究数据集（Nature Scientific Data）](https://www.nature.com/articles/s41597-023-02876-8)

## 6. 对 na_smoke_map 的落地建议

判断一个火"是否需要关注"，建议按信号叠加打分：

1. **规模**：WFIGS `IncidentSize` ≥ 100 英亩（草地 300 英亩）——直接复用 IMSR 官方门槛；
2. **管理级别**：是否出现在当日 IMSR 报告中（等价于官方认定的"大火"）；
3. **人的影响**：有疏散令、受威胁建筑数 > 0，或 HMS 烟羽覆盖大城市；
4. **趋势**：控制率低 + 面积快速增长优先。

实施路径（成本从低到高）：

- **最低成本**：只用现有 WFIGS 数据，按 ICS-209 衍生字段（面积、控制率、建筑威胁）过滤/分级展示；
- **进阶**：在 WFIGS 内用 IMSR 同口径（面积 ≥ 100/300 英亩、有 ICS-209 填报）打"官方大火"标签（见第 5 节结论，无需解析 IMSR PDF）；
- **更进一步**：叠加 HMS 烟羽 + AirNow PM2.5，把"烟雾影响人口"作为独立的关注度维度。

## 7. 待细化的问题

- [ ] "关注度"评分的具体权重与分级（如：高/中/低三档？）
- [x] ~~IMSR PDF 解析的可行性~~ → 已解决：IMSR 与 WFIGS 共享上游数据（IRWIN/ICS-209），直接在 WFIGS 内按同口径过滤即可，见第 5 节
- [x] ~~WFIGS 中哪些 ICS-209 字段实际可用~~ → 部分解决（2026-07-24 实测）：`ICS209ReportDateTime/Status`、`IncidentSize`、`PercentContained`、`TotalIncidentPersonnel`、`IncidentManagementOrganization`、`IncidentComplexityLevel`、`EstimatedCostToDate` 可用；**建筑威胁/损毁字段在公开层不存在**；数字与 IMSR 可能双向不同步（见第 5 节实证核验）
- [ ] 公开 WFIGS 服务有分钟级请求配额（实测遇到 429，全服务共享 57,600 request units/分钟），客户端需要做缓存与退避重试
- [ ] 是否需要覆盖加拿大火情（跨境烟雾对美国空气质量影响大）
- [ ] 数据刷新频率与缓存策略
