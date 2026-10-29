package com.rplink.app;

import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.BaseAdapter;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.OutputStream;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import javax.net.ssl.HttpsURLConnection;

/** Character worldline picker: choose a parallel line, then enter its chat. */
public final class WorldlineActivity extends AppCompatActivity {
    public static final String EXTRA_SERVER_ID = "server_id";
    public static final String EXTRA_CHARACTER_ID = "character_id";
    public static final String EXTRA_CHARACTER_NAME = "character_name";

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final List<JSONObject> lines = new ArrayList<>();
    private ServerRecord server;
    private String characterId = "";
    private String characterName = "角色";
    private ListView listView;
    private TextView emptyView;
    private Adapter adapter;
    private boolean destroyed;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        characterId = getIntent().getStringExtra(EXTRA_CHARACTER_ID) == null
                ? "" : getIntent().getStringExtra(EXTRA_CHARACTER_ID);
        String name = getIntent().getStringExtra(EXTRA_CHARACTER_NAME);
        if (name != null && !name.isEmpty()) characterName = name;
        server = new ServerStore(this).find(getIntent().getStringExtra(EXTRA_SERVER_ID));
        if (server == null) {
            finish();
            return;
        }
        setContentView(R.layout.activity_worldline);
        if (getSupportActionBar() != null) {
            getSupportActionBar().setTitle(server.name + " · " + characterName);
            getSupportActionBar().setDisplayHomeAsUpEnabled(true);
        }
        TextView title = findViewById(R.id.worldline_character);
        title.setText(characterName);
        listView = findViewById(R.id.worldline_list);
        emptyView = findViewById(R.id.worldline_empty);
        adapter = new Adapter();
        listView.setAdapter(adapter);
        listView.setOnItemClickListener((parent, view, position, id) -> openLine(lines.get(position)));
        listView.setOnItemLongClickListener((parent, view, position, id) -> {
            showLineActions(lines.get(position));
            return true;
        });
        findViewById(R.id.worldline_create).setOnClickListener(view -> showCreateDialog());
        load();
    }

    @Override
    public boolean onSupportNavigateUp() {
        finish();
        return true;
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (!destroyed) load();
    }

    @Override
    protected void onDestroy() {
        destroyed = true;
        executor.shutdownNow();
        super.onDestroy();
    }

    private void load() {
        executor.execute(() -> {
            try {
                String query = URLEncoder.encode(characterId, StandardCharsets.UTF_8.name());
                JSONObject result = request("GET", "/api/worldlines?characterId=" + query, null);
                JSONArray array = result.optJSONArray("worldlines");
                List<JSONObject> next = new ArrayList<>();
                if (array != null) {
                    for (int index = 0; index < array.length(); index += 1) {
                        JSONObject item = array.optJSONObject(index);
                        if (item != null) next.add(item);
                    }
                }
                main.post(() -> {
                    lines.clear();
                    lines.addAll(next);
                    adapter.notifyDataSetChanged();
                    emptyView.setVisibility(lines.isEmpty() ? View.VISIBLE : View.GONE);
                    listView.setVisibility(lines.isEmpty() ? View.GONE : View.VISIBLE);
                });
            } catch (Exception error) {
                main.post(() -> Toast.makeText(this, "读取世界线失败", Toast.LENGTH_SHORT).show());
            }
        });
    }

    private void openLine(JSONObject line) {
        String id = line.optString("id", "");
        String name = line.optString("name", "世界线");
        String chapterId = line.optString("activeChapterId", "");
        if (id.isEmpty()) return;
        if (chapterId.isEmpty()) {
            executor.execute(() -> {
                try {
                    JSONObject body = new JSONObject();
                    body.put("characterId", characterId);
                    body.put("worldlineId", id);
                    JSONObject result = request("POST", "/api/conversations", body);
                    JSONObject conversation = result.optJSONObject("conversation");
                    String created = conversation == null ? "" : conversation.optString("id", "");
                    main.post(() -> {
                        if (created.isEmpty()) {
                            Toast.makeText(this, "创建章节失败", Toast.LENGTH_SHORT).show();
                        } else {
                            openChapter(id, name, created);
                        }
                    });
                } catch (Exception error) {
                    main.post(() -> Toast.makeText(this, "创建章节失败", Toast.LENGTH_SHORT).show());
                }
            });
            return;
        }
        openChapter(id, name, chapterId);
    }

    private void openChapter(String lineId, String lineName, String chapterId) {
        Intent intent = new Intent(this, ChatActivity.class);
        intent.putExtra(ChatActivity.EXTRA_SERVER_ID, server.id);
        intent.putExtra(ChatActivity.EXTRA_CHARACTER_ID, characterId);
        intent.putExtra(ChatActivity.EXTRA_CHARACTER_NAME, characterName);
        intent.putExtra(ChatActivity.EXTRA_WORLDLINE_ID, lineId);
        intent.putExtra(ChatActivity.EXTRA_WORLDLINE_NAME, lineName);
        intent.putExtra(ChatActivity.EXTRA_CONVERSATION_ID, chapterId);
        startActivity(intent);
    }

    private void showCreateDialog() {
        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        form.setPadding(dp(20), dp(8), dp(20), 0);
        EditText nameInput = new EditText(this);
        nameInput.setHint("世界线名称，例如：如果线·圆满");
        nameInput.setSingleLine(true);
        form.addView(nameInput);
        EditText premiseInput = new EditText(this);
        premiseInput.setHint("世界线前提（可选）");
        premiseInput.setMinLines(3);
        premiseInput.setGravity(Gravity.TOP);
        premiseInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
        form.addView(premiseInput);
        CheckBox inject = new CheckBox(this);
        inject.setText("注入世界线前提");
        inject.setChecked(true);
        form.addView(inject);
        new AlertDialog.Builder(this)
                .setTitle("新建世界线")
                .setView(form)
                .setNegativeButton("取消", null)
                .setPositiveButton("创建", (dialog, which) -> createLine(
                        nameInput.getText().toString().trim(),
                        premiseInput.getText().toString().trim(),
                        inject.isChecked()))
                .show();
    }

    private void createLine(String name, String premise, boolean inject) {
        executor.execute(() -> {
            try {
                JSONObject body = new JSONObject();
                body.put("action", "create");
                body.put("characterId", characterId);
                body.put("name", name.isEmpty() ? "新的世界线" : name);
                body.put("premise", premise);
                body.put("premiseEnabled", inject);
                request("POST", "/api/worldlines", body);
                main.post(() -> {
                    Toast.makeText(this, "世界线已创建", Toast.LENGTH_SHORT).show();
                    load();
                });
            } catch (Exception error) {
                main.post(() -> Toast.makeText(this, "创建失败", Toast.LENGTH_SHORT).show());
            }
        });
    }

    private void showLineActions(JSONObject line) {
        boolean isDefault = line.optBoolean("isDefault", false);
        List<String> actions = new ArrayList<>();
        actions.add("编辑");
        if (!isDefault) actions.add("归档");
        new AlertDialog.Builder(this)
                .setTitle(line.optString("name", "世界线"))
                .setItems(actions.toArray(new String[0]), (dialog, which) -> {
                    if (which == 0) showEditDialog(line);
                    else archiveLine(line);
                })
                .setNegativeButton("取消", null)
                .show();
    }

    private void showEditDialog(JSONObject line) {
        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        form.setPadding(dp(20), dp(8), dp(20), 0);
        EditText nameInput = new EditText(this);
        nameInput.setText(line.optString("name", ""));
        nameInput.setSingleLine(true);
        form.addView(nameInput);
        EditText premiseInput = new EditText(this);
        premiseInput.setText(line.optString("premise", ""));
        premiseInput.setMinLines(3);
        premiseInput.setGravity(Gravity.TOP);
        premiseInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
        form.addView(premiseInput);
        CheckBox inject = new CheckBox(this);
        inject.setText("注入世界线前提");
        inject.setChecked(line.optBoolean("premiseEnabled", true));
        form.addView(inject);
        new AlertDialog.Builder(this)
                .setTitle("编辑世界线")
                .setView(form)
                .setNegativeButton("取消", null)
                .setPositiveButton("保存", (dialog, which) -> updateLine(
                        line.optString("id", ""),
                        nameInput.getText().toString().trim(),
                        premiseInput.getText().toString().trim(),
                        inject.isChecked()))
                .show();
    }

    private void updateLine(String id, String name, String premise, boolean inject) {
        executor.execute(() -> {
            try {
                JSONObject body = new JSONObject();
                body.put("action", "update");
                body.put("characterId", characterId);
                body.put("id", id);
                body.put("name", name);
                body.put("premise", premise);
                body.put("premiseEnabled", inject);
                request("POST", "/api/worldlines", body);
                main.post(() -> {
                    Toast.makeText(this, "已保存", Toast.LENGTH_SHORT).show();
                    load();
                });
            } catch (Exception error) {
                main.post(() -> Toast.makeText(this, "保存失败", Toast.LENGTH_SHORT).show());
            }
        });
    }

    private void archiveLine(JSONObject line) {
        new AlertDialog.Builder(this)
                .setTitle("归档世界线")
                .setMessage("「" + line.optString("name", "世界线") + "」将不再显示，聊天记录保留。")
                .setNegativeButton("取消", null)
                .setPositiveButton("归档", (dialog, which) -> executor.execute(() -> {
                    try {
                        JSONObject body = new JSONObject();
                        body.put("action", "archive");
                        body.put("characterId", characterId);
                        body.put("id", line.optString("id", ""));
                        request("POST", "/api/worldlines", body);
                        main.post(() -> {
                            Toast.makeText(this, "已归档", Toast.LENGTH_SHORT).show();
                            load();
                        });
                    } catch (Exception error) {
                        main.post(() -> Toast.makeText(this, "归档失败", Toast.LENGTH_SHORT).show());
                    }
                }))
                .show();
    }

    private JSONObject request(String method, String path, JSONObject body) throws Exception {
        HttpsURLConnection connection = TlsSupport.open(
                server.host, server.port, server.caPem, path, server.token, 8000);
        connection.setRequestMethod(method);
        connection.setRequestProperty("x-rp-token", server.token);
        if (body != null) {
            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream output = connection.getOutputStream()) {
                output.write(bytes);
            }
        }
        int status = connection.getResponseCode();
        java.io.InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
        String text = TlsSupport.readAll(stream);
        connection.disconnect();
        if (status != 200) throw new IllegalStateException("HTTP " + status);
        return new JSONObject(text);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private final class Adapter extends BaseAdapter {
        @Override
        public int getCount() {
            return lines.size();
        }

        @Override
        public Object getItem(int position) {
            return lines.get(position);
        }

        @Override
        public long getItemId(int position) {
            return position;
        }

        @Override
        public View getView(int position, View convertView, ViewGroup parent) {
            LinearLayout row = new LinearLayout(WorldlineActivity.this);
            row.setOrientation(LinearLayout.VERTICAL);
            row.setPadding(dp(14), dp(12), dp(14), dp(12));
            row.setBackgroundColor(Color.parseColor("#141C2E"));
            LinearLayout.LayoutParams rowParams = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            rowParams.bottomMargin = dp(8);
            row.setLayoutParams(rowParams);

            JSONObject line = lines.get(position);
            TextView name = new TextView(WorldlineActivity.this);
            name.setText(line.optString("name", "世界线"));
            name.setTextColor(Color.parseColor("#EEF2F8"));
            name.setTextSize(16);
            name.setTypeface(null, android.graphics.Typeface.BOLD);
            row.addView(name);

            TextView meta = new TextView(WorldlineActivity.this);
            int count = line.optInt("chapterCount", 0);
            int active = line.optInt("activeChapterIndex", 0);
            String text = count == 0 ? "尚无章节" : ("共 " + count + " 章" + (active > 0 ? " · 当前第 " + active + " 章" : ""));
            if (line.optBoolean("isDefault", false)) text += " · 主线";
            meta.setText(text);
            meta.setTextColor(Color.parseColor("#9AA8BD"));
            meta.setTextSize(12);
            meta.setPadding(0, dp(4), 0, 0);
            row.addView(meta);
            return row;
        }
    }
}
