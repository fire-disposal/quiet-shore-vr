# 站立感与失重感：检索记录

本文记录 2026-10-23 为“仰卧患者 + 站立视角”方案做的文献检索，只收录**确实读到**的内容，并区分阅读深度。产品结论见 `core.md`；这里保留证据与不确定处。

## 1. 阅读深度

| 标记 | 含义 |
| --- | --- |
| 精读 | 读过摘要、引言与结果部分 |
| 摘要 | 只读过摘要或检索摘要 |
| 标题 | 只见到标题与一句话描述，未读正文 |

## 2. 直接支撑设计的结论

### 2.1 水面沉浸与视动觉（精读）

Fauville G., Queiroz A.C.M., Woolsey E.S., Kelly J.W., Bailenson J.N. (2021).
*The effect of water immersion on vection in virtual reality.*
Scientific Reports 11:1022. DOI [10.1038/s41598-020-80100-y](https://doi.org/10.1038/s41598-020-80100-y) · [PMC7806968](https://pmc.ncbi.nlm.nih.gov/articles/PMC7806968/)

- 泡在水中时视动觉（vection，静止者的自我运动错觉）显著强于站在地面：距离估计均值 3.10 m vs 0.75 m。
- 两组在晕动（SSQ）与在场感上无显著差异。
- 作者解释：水中漂浮使前庭“下方”参照变得模糊，视觉输入权重上升，视觉与前庭冲突下降。
- 引言引用的既往工作指出：**仰卧时对平行于地面的视觉运动，视动觉起效快于坐姿**；身体偏离垂直轴会增加沿体轴的视动觉；视动觉起效有 1–10 s 延迟，延迟与感觉冲突相关。
- 引言引用的既往工作还指出：**听觉单独产生视动觉很弱，但与视觉运动同时呈现时贡献显著**；隧道材质实验显示织物、木、树皮、皮革诱发的视动觉强于陶瓷、玻璃、金属。

对我们的用法：仰卧不是缺陷；运动应沿体轴（患者视角的上下）；声音必须与视觉运动同步；软材质优于纯瓷砖。

### 2.2 视觉重定向与主观垂直（标题/摘要）

NASA NTRS 20030068201, *The Role of Visual Cues in Microgravity Spatial Orientation*.

- 视觉重定向错觉可使“天花板”与“地板”互换；**主观垂直方向的不稳定会引发定向障碍与太空晕动**。

对我们的用法：世界旋转完成后，地平线必须稳定，滚转接近零；不要在站立态叠加摆动。

### 2.3 光学流与晕动的两条干预（摘要）

- *Adaptive Field-of-view Restriction: Limiting Optical Flow to Mitigate Cybersickness in Virtual Reality*，ACM，DOI [10.1145/3562939.3565611](https://doi.org/10.1145/3562939.3565611)：按实时光学流自适应限制视野可缓解晕动，作者认为这是成本与收益较优的折中。
- *Mixing in Reverse Optical Flow to Mitigate Vection and Cybersickness*，CHI 2022，DOI [10.1145/3491102.3501847](https://doi.org/10.1145/3491102.3501847)：混入反向量可削弱 vection 与晕动。

对我们的用法：周边短暂收窄可用于起身阶段；**不要**用反向流去压晕动，它会同时把站立感/漂浮感压掉。

### 2.4 其他相关（摘要）

- *VR Sickness Adaptation With Ramped Optic Flow Transfers*，[NSF PAR 10355651](https://par.nsf.gov/servlets/purl/10355651)：逐步增强光学流可提高耐受性 → 运动要渐进引入。
- *Vibrations Reduce Cybersickness and Enhance Presence in VR*，ISMAR-Adjunct 2024：振动线索可降低晕动并提升在场感 → PICO G2 无可用触觉通道，只能靠视觉与听觉替代。
- *The presence of an avatar can reduce cybersickness in VR*，Virtual Reality，DOI [10.1007/s10055-024-01057-1](https://doi.org/10.1007/s10055-024-01057-1)：可见的身体化形象与晕动相关。
- *The Oculus Rift: a cost-effective tool for studying visual-vestibular interactions in self-motion perception*，Frontiers in Psychology 2015;6:24（[PubMed 25821438](https://pubmed.ncbi.nlm.nih.gov/25821438/)）。
- *The effect of vection on the use of optic flow cues*，Royal Society Open Science 2025;12(7):250364（[PubMed 40708673](https://pubmed.ncbi.nlm.nih.gov/40708673/)）。
- *Cybersickness: a Multisensory Integration Perspective*，Multisensory Research 2018;31:645–674（[PubMed 31264611](https://pubmed.ncbi.nlm.nih.gov/31264611/)）。
- *The Impact of Sensory Levels on Presence and Cybersickness in Virtual Reality*，VRST 2025，DOI [10.1145/3756884.3766030](https://doi.org/10.1145/3756884.3766030)。
- *What do people feel in a zero-gravity environment?*，Scientific American：零重力体感并非“无限坠落”，而是缺乏“被压住”的感觉。

## 3. 由证据到实现

| 线索 | 依据 | 实现位置 |
| --- | --- | --- |
| 沿体轴的缓慢竖向运动 | 2.1（仰卧/体轴） | `src/core/xr/float.ts` 主曲线 |
| 运动渐入、停止渐出 | 2.1（起效延迟）、2.4（渐进） | `easeAmplitude`，tau 0.25 s |
| 叠加微小振荡与二次谐波 | 2.1（引言提到对视觉场加抖动/振荡可影响 vection） | 曲线谐波 + 0.37 Hz 微颤 |
| 声音与运动同相位 | 2.1（听觉与视觉同时呈现时贡献显著） | `setBuoyancySwell`（LFO 跟随漂浮周期） |
| 稳定地平线，站立态不滚转 | 2.2 | 姿态层；漂浮档 c 仅 1° 俯仰 |
| 软材质与木质元素 | 2.1（材质对比） | 场景素材选择（待办） |
| 不引入反向流 | 2.3 | 设计约束 |

## 4. 属于推断、尚无依据的部分

- **“站立感”本身没有直接文献**：上述研究测的是 vection、晕动与在场感，没有一篇测量“患者认为自己站着”。把视点高度、近景地面、腰高参照物组合成站立感，是工程推断。
- 视觉高度（1.70 m）与卫生间几何的比例是否自洽，未在设备上核对。
- 这些实验的被试多为健康成年人、设备多为 6DoF 头显；我们面向卧床患者、3DoF 头显，外推有风险。
- 舒适阈值（幅度、周期、微颤强度）没有文献可直接给出，只能靠实机与志愿者。

## 5. 未使用但可能相关

检索中出现但未采用的条目，留作后续：

- *Virtual acceleration with galvanic vestibular stimulation in a virtual reality environment*，IEEE VR 2005（需要电前庭刺激硬件）。
- *Air cushion: a pilot study of the passive technique to mitigate simulator sickness by responding to vection*，IEEE VR 2017。
- *Comparing the effectiveness of different displays in enhancing illusions of self-movement (vection)*，[PubMed 26082735](https://pubmed.ncbi.nlm.nih.gov/26082735/)。
