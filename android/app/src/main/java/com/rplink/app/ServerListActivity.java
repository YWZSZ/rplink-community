package com.rplink.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.BaseAdapter;
import android.widget.ListView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class ServerListActivity extends AppCompatActivity {
    private static final int REQUEST_PAIR = 10;
    private static final int REQUEST_NOTIFICATIONS = 11;

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Map<String, Boolean> online = new HashMap<>();
    private final List<Item> items = new ArrayList<>();
    private ServerStore store;
    private List<ServerRecord> servers = new ArrayList<>();
    private ServerAdapter adapter;
    private ListView listView;
    private View emptyState;
    private TextView emptyTitle;
    private TextView emptyHint;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_server_list);
        if (getSupportActionBar() != null) getSupportActionBar().hide();
        getWindow().setStatusBarColor(ContextCompat.getColor(this, R.color.bg));
        store = new ServerStore(this);
        listView = findViewById(R.id.server_list);
        emptyState = findViewById(R.id.empty_state);
        emptyTitle = findViewById(R.id.empty_title);
        emptyHint = findViewById(R.id.empty_hint);
        adapter = new ServerAdapter();
        listView.setAdapter(adapter);
        listView.setOnItemClickListener((parent, view, position, id) -> openItem(items.get(position)));
        listView.setOnItemLongClickListener((parent, view, position, id) -> {
            confirmDelete(items.get(position).server);
            return true;
        });
        findViewById(R.id.scan_button).setOnClickListener(view -> startActivityForResult(new Intent(this, PairActivity.class), REQUEST_PAIR));
        findViewById(R.id.paste_button).setOnClickListener(view -> {
            Intent intent = new Intent(this, PairActivity.class);
            intent.putExtra(PairActivity.EXTRA_AUTO_PASTE, true);
            startActivityForResult(intent, REQUEST_PAIR);
        });
        findViewById(R.id.settings_button).setOnClickListener(view -> {
            Intent intent = new Intent(this, SettingsActivity.class);
            if (!servers.isEmpty()) intent.putExtra(SettingsActivity.EXTRA_SERVER_ID, servers.get(0).id);
            startActivity(intent);
        });
        requestNotificationPermission();
    }

    @Override
    protected void onResume() {
        super.onResume();
        reload();
        refreshStatuses();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQUEST_PAIR) reload();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        executor.shutdownNow();
    }

    private void reload() {
        servers = store.list();
        servers.sort((left, right) -> Long.compare(right.lastUsedAt, left.lastUsedAt));
        if (servers.isEmpty()) {
            items.clear();
            adapter.notifyDataSetChanged();
            showEmpty(false);
            return;
        }
        showEmpty(false);
        fetchCharacters(servers.get(0));
    }

    private void fetchCharacters(ServerRecord server) {
        executor.execute(() -> {
            try {
                JSONObject bootstrap = TlsSupport.bootstrap(server);
                JSONArray array = bootstrap.optJSONArray("characters");
                List<Item> next = new ArrayList<>();
                if (array != null) {
                    for (int index = 0; index < array.length(); index += 1) {
                        JSONObject character = array.optJSONObject(index);
                        if (character == null) continue;
                        String id = character.optString("id", "");
                        String name = character.optString("name", "角色");
                        if (id.isEmpty() || name.isEmpty()) continue;
                        next.add(new Item(server, id, name, character.optString("tagline", "")));
                    }
                }
                main.post(() -> {
                    items.clear();
                    items.addAll(next);
                    adapter.notifyDataSetChanged();
                    showEmpty(items.isEmpty());
                });
            } catch (Exception error) {
                main.post(() -> {
                    items.clear();
                    adapter.notifyDataSetChanged();
                    showEmpty(true);
                });
            }
        });
    }

    private void showEmpty(boolean offline) {
        boolean empty = items.isEmpty();
        emptyState.setVisibility(empty ? View.VISIBLE : View.GONE);
        listView.setVisibility(empty ? View.GONE : View.VISIBLE);
        if (empty) {
            emptyTitle.setText(offline ? R.string.empty_offline_title : R.string.empty_title);
            emptyHint.setText(offline ? R.string.empty_offline_hint : R.string.empty_hint);
        }
    }

    private void refreshStatuses() {
        List<ServerRecord> snapshot = new ArrayList<>(servers);
        executor.execute(() -> {
            for (ServerRecord server : snapshot) {
                boolean reachable;
                try {
                    String body = TlsSupport.health(server.host, server.port, server.caPem, server.token, 5000);
                    JSONObject health = new JSONObject(body);
                    reachable = health.optBoolean("ok", false);
                } catch (Exception error) {
                    reachable = false;
                }
                online.put(server.id, reachable);
                main.post(adapter::notifyDataSetChanged);
            }
        });
    }

    private void openItem(Item item) {
        store.touch(item.server.id);
        Intent intent = new Intent(this, WorldlineActivity.class);
        intent.putExtra(WorldlineActivity.EXTRA_SERVER_ID, item.server.id);
        intent.putExtra(WorldlineActivity.EXTRA_CHARACTER_ID, item.characterId);
        intent.putExtra(WorldlineActivity.EXTRA_CHARACTER_NAME, item.name);
        startActivity(intent);
    }

    private void confirmDelete(ServerRecord server) {
        new AlertDialog.Builder(this)
                .setTitle(getString(R.string.delete_server))
                .setMessage(getString(R.string.delete_server_hint))
                .setNegativeButton("取消", null)
                .setPositiveButton("删除", (dialog, which) -> {
                    store.remove(server.id);
                    online.remove(server.id);
                    reload();
                })
                .show();
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33
                && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQUEST_NOTIFICATIONS);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQUEST_NOTIFICATIONS && grantResults.length > 0 && grantResults[0] != PackageManager.PERMISSION_GRANTED) {
            Toast.makeText(this, R.string.notification_permission, Toast.LENGTH_LONG).show();
        }
    }

    private static final class Item {
        final ServerRecord server;
        final String characterId;
        final String name;
        final String tagline;

        Item(ServerRecord server, String characterId, String name, String tagline) {
            this.server = server;
            this.characterId = characterId;
            this.name = name;
            this.tagline = tagline;
        }
    }

    private final class ServerAdapter extends BaseAdapter {
        private final LayoutInflater inflater = LayoutInflater.from(ServerListActivity.this);

        @Override
        public int getCount() {
            return items.size();
        }

        @Override
        public Item getItem(int position) {
            return items.get(position);
        }

        @Override
        public long getItemId(int position) {
            return position;
        }

        @Override
        public View getView(int position, View convertView, ViewGroup parent) {
            View view = convertView;
            if (view == null) view = inflater.inflate(R.layout.item_server, parent, false);
            Item item = getItem(position);
            TextView name = view.findViewById(R.id.server_name);
            TextView host = view.findViewById(R.id.server_host);
            TextView status = view.findViewById(R.id.server_status);
            name.setText(item.name);
            host.setText(item.tagline == null || item.tagline.isEmpty() ? item.server.name : item.tagline);
            Boolean reachable = online.get(item.server.id);
            if (reachable == null) {
                status.setText(R.string.unknown);
                status.setTextColor(Color.parseColor("#9AA8BD"));
            } else if (reachable) {
                status.setText(R.string.online);
                status.setTextColor(ContextCompat.getColor(ServerListActivity.this, R.color.ok));
            } else {
                status.setText(R.string.offline);
                status.setTextColor(ContextCompat.getColor(ServerListActivity.this, R.color.text_dim));
            }
            return view;
        }
    }
}
