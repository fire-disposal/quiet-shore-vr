# 角度契约

## 1 约定

- 世界角用度数，绕指定轴作用于内容。
- `+pitchDeg` 绕 X，内容上移，患者看到更多地面的反向关系。
- `+yawDeg` 绕 Y。
- `+rollDeg` 绕 Z。
- 欧拉顺序 `XYZ`；无偏航时等价于 `Rx(pitch) * Rz(roll)`。
- 患者感知方向与世界旋转相反，符号翻转只在 `viewToWorld` 一处发生。

## 2 唯一写入者

| 层 | 写入者 | 内容 |
| --- | --- | --- |
| world-shell | `world-shell` | 视角旋转，绕眼点 |
| base | `comfort` | 校准 yaw 与 pitch/roll 修正的 `mix` |
| content | `SceneHost` | 眼高偏移与漂浮位移 |

- 相机姿态只读，不参与世界层写入。
- 世界旋转每帧至多写一次。
- 任何代码不得从四元数反推姿态角再写回。

## 3 校准分解

校准 quaternion 按 `YXZ` 分解：

```text
q0 = qYaw * qCorrection
qTotal = qYaw * slerp(identity, qCorrection, mix)
```

- `mix = 0` 保留真实天花板。
- `mix = 1` 面向站立视角。
- 世界绕校准时的头部位置旋转，眼点保持不动。

## 4 视角通道

| 通道 | 正方向 | 范围 | 消费者 |
| --- | --- | --- | --- |
| 俯仰 | 患者看到更多天空 | ±90° | 世界 pitch 取反 |
| 偏航 | 患者向左看 | ±180° | 世界 yaw 取反 |
| roll | 头部倾斜的镜像还原 | 遥测输入 | 镜像相机 |

状态帧只发送已应用的 `worldQuat xyz` 与 `viewPitch/viewYaw`，字段见 `protocol.md`。

## 5 不变式

- 一个角度只有一个来源：已写入变换或已应用标量。
- 视角停止不改变世界姿态。
- 姿态停止不自动回正。
- 镜像相机严格按 `world^-1 * head` 组合中心射线。
- 旧代际的字节向量与迁移状态不再保留，字节真值只在 `StateFrameTest`。
