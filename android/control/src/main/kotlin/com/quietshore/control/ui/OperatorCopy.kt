package com.quietshore.control.ui

import com.quietshore.control.model.UiEvent

/**
 * Every sentence the app says to the operator, in one place.
 *
 * Rules from the 冷库 brief: one sentence, one fact; start with the verb; say
 * "您"; no style words; no internal vocabulary (protocol, MTU, ACK, decoder)
 * on an operator surface. A refusal always ends with the next step, because a
 * refusal with no next step is just noise.
 *
 * The BLE layer and the view model still raise `UiEvent`s in their own words —
 * they are not UI — so both screens pass those through [operatorText]. That
 * keeps one technical leak from reaching the glass, and gives the wording a
 * single file to change.
 */
object OperatorCopy {

    /** The link dropped and the controller is retrying. */
    const val LINK_RETRYING = "头显没有回应。正在重连，保持头显开机。"
    const val PAGE_NOT_OPEN = "头显里的训练页面没开。再点一次“启动训练”。"
    const val NOT_CONNECTED = "头显未连接。回到配对页重新连接。"
    const val NOT_ACKED = "头显没有确认这条指令。确认头显在前台，再按一次。"
    const val QUEUE_FULL = "指令发得太快。等一秒再按。"
    const val BUSY = "头显正忙。等两秒再按。"
    const val SHORT_FRAME = "头显上报的数据太短，读数可能不更新。重启头显应用。"
    const val CONTROL_TAKEN = "另一台平板正在控制这台头显。在那台平板上断开，再连这里。"
    const val CONTROL_LOST = "控制权已丢失。回到配对页重新连接。"

    /** Resolve an event raised by the controller or the view model. */
    fun operatorText(event: UiEvent): String = when (event) {
        is UiEvent.Notice -> notice(event.text)
        is UiEvent.Error -> error(event.text)
    }

    private fun notice(raw: String): String = when {
        raw.startsWith("已请求启动") -> "已请求启动。请患者按一次头显右侧按钮。"
        raw.startsWith("头显已接收") -> "头显已接收。"
        raw == "已释放控制" -> "已释放控制。"
        raw.startsWith("SUS 已记录") -> raw
        raw.startsWith("已打开导出分享") -> "已打开分享面板。"
        raw.startsWith("连接中断，正在重连") -> raw
        else -> raw
    }

    private fun error(raw: String): String = when {
        raw.startsWith("页面未连接") -> PAGE_NOT_OPEN
        raw.startsWith("头显未连接") -> NOT_CONNECTED
        raw.startsWith("头显未确认命令") || raw.startsWith("发送命令失败") -> NOT_ACKED
        raw.startsWith("头显忙") -> BUSY
        raw.startsWith("头显拒绝命令") -> "头显没有执行这条指令。再按一次；仍失败就重新进入场景。"
        raw.startsWith("命令队列已满") -> QUEUE_FULL
        raw.startsWith("蓝牙包长不足") -> SHORT_FRAME
        raw.startsWith("头显正被另一台平板") -> CONTROL_TAKEN
        raw.startsWith("控制连接已失效") || raw.startsWith("蓝牙心跳超时") ||
            raw.startsWith("未获得控制权") -> CONTROL_LOST
        raw.startsWith("头显已释放控制权") -> "头显已交回自己的入口页。点“启动训练”可以再接管。"
        raw.startsWith("未搜索到任何蓝牙设备") -> "没有搜到任何设备。打开定位服务后再搜索。"
        raw.startsWith("请先开启定位服务") -> "部分平板没有定位服务就搜不到头显。打开定位服务再搜索。"
        raw.startsWith("缺少蓝牙") -> "缺少蓝牙权限。在应用设置里打开“附近设备”，再回来搜索。"
        raw.startsWith("正在与头显握手") -> "正在与头显握手。等两秒再按。"
        raw.startsWith("头显固件缺少功能") || raw.startsWith("头显协议版本不兼容") ->
            raw.substringBefore("，请更新头显应用") + "。在头显上更新应用后重连。"
        raw.startsWith("暂无已归档") -> "还没有归档的量表。先完成一份。"
        raw.startsWith("没有可接收导出") -> "平板上没有能接收文件的分享目标。先装一个文件管理器或邮件应用。"
        raw.startsWith("无法打开蓝牙开关") -> "打不开蓝牙开关。到系统设置里手动打开蓝牙。"
        raw.startsWith("无法打开应用设置") -> "打不开应用设置。到系统设置里找到静岸控制台，手动打开权限。"
        raw.startsWith("蓝牙未开启") -> "蓝牙未开启。打开平板蓝牙后再搜索。"
        raw.startsWith("搜索失败") -> "搜索中断了。再点一次“搜索头显”。"
        raw.startsWith("不支持的命令") -> "平板和头显的版本对不上。更新头显应用后重连。"
        else -> raw
    }
}
