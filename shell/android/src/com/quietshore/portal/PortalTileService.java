package com.quietshore.portal;

import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;

/**
 * 快捷磁贴：下拉通知栏里点一下进入训练。
 * 磁贴本身不持有服务状态，点击时才确保服务在跑。
 */
public class PortalTileService extends TileService {
    private static final String TILE_LABEL = "静岸";

    @Override
    public void onClick() {
        super.onClick();
        PortalActions.enter(this);
    }

    @Override
    public void onStartListening() {
        super.onStartListening();
        updateTile();
    }

    @Override
    public void onTileAdded() {
        super.onTileAdded();
        updateTile();
    }

    private void updateTile() {
        Tile tile = getQsTile();
        if (tile == null) {
            return;
        }
        tile.setLabel(TILE_LABEL);
        tile.setState(Tile.STATE_ACTIVE);
        tile.updateTile();
    }
}
