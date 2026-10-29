package com.rplink.app;

import android.app.Application;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;

public final class DshLinkApp extends Application {
    public static final String DOWNLOAD_CHANNEL = "dsh_link_downloads";

    @Override
    public void onCreate() {
        super.onCreate();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    DOWNLOAD_CHANNEL,
                    getString(R.string.download_channel),
                    NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("DSH Link 文件下载进度");
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) manager.createNotificationChannel(channel);
        }
    }
}
