package com.quietshore.portal

import android.content.Intent
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

/**
 * 快捷磁贴：打开静岸控制台，不直接跳转 Firefox。
 * 入口本身不持有服务状态，控制台会确保服务在跑。
 */
class PortalTileService : TileService() {
    override fun onClick() {
        super.onClick()
        startActivityAndCollapse(Intent(this, PortalActivity::class.java))
    }

    override fun onStartListening() {
        super.onStartListening()
        updateTile()
    }

    override fun onTileAdded() {
        super.onTileAdded()
        updateTile()
    }

    private fun updateTile() {
        val tile = getQsTile() ?: return
        tile.setLabel(TILE_LABEL)
        tile.setIcon(BrandAssets.largeIcon())
        tile.setState(Tile.STATE_ACTIVE)
        tile.updateTile()
    }

    private companion object {
        const val TILE_LABEL = "静岸"
    }
}
