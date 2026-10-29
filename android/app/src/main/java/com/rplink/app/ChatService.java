package com.rplink.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

/** Keeps the app process alive while a chat connection is open. */
public final class ChatService extends Service {
    private static final String CHANNEL = "rplink_connection";
    private static final int NOTIFICATION_ID = 41;
    private static final String EXTRA_SERVER_ID = "server_id";

    public static void start(Context context, String serverId) {
        start(context, serverId, "");
    }

    public static void start(Context context, String serverId, String characterId) {
        Intent intent = new Intent(context, ChatService.class);
        intent.putExtra(EXTRA_SERVER_ID, serverId);
        intent.putExtra("character_id", characterId);
        ContextCompat.startForegroundService(context, intent);
    }

    public static void stop(Context context) {
        context.stopService(new Intent(context, ChatService.class));
    }

    @Override
    public void onCreate() {
        super.onCreate();
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL,
                    "RPLink 连接",
                    NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("保持与电脑的连接");
            manager.createNotificationChannel(channel);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String serverId = intent == null ? "" : intent.getStringExtra(EXTRA_SERVER_ID);
        String characterId = intent == null ? "" : intent.getStringExtra("character_id");
        Intent open = new Intent(this, WorldlineActivity.class);
        open.putExtra(WorldlineActivity.EXTRA_SERVER_ID, serverId);
        open.putExtra(WorldlineActivity.EXTRA_CHARACTER_ID, characterId);
        open.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pending = PendingIntent.getActivity(
                this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification notification = new NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(android.R.drawable.stat_notify_sync)
                .setContentTitle("RPLink")
                .setContentText("正在保持连接")
                .setContentIntent(pending)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();
        startForeground(NOTIFICATION_ID, notification);
        return START_NOT_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
