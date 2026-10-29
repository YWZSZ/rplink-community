package com.rplink.app;

import android.app.DatePickerDialog;
import android.app.TimePickerDialog;
import android.content.ContentValues;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.drawable.BitmapDrawable;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.util.Base64;
import android.text.Editable;
import android.text.TextWatcher;
import android.text.method.ScrollingMovementMethod;
import android.view.Gravity;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.HorizontalScrollView;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.KeyStore;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509TrustManager;

import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

/** Character chat with message bubbles, streaming, service-backed reconnect. */
public final class ChatActivity extends AppCompatActivity {
    public static final String EXTRA_SERVER_ID = "server_id";
    public static final String EXTRA_CHARACTER_ID = "character_id";
    public static final String EXTRA_CHARACTER_NAME = "character_name";
    public static final String EXTRA_CONVERSATION_ID = "conversation_id";
    public static final String EXTRA_WORLDLINE_ID = "worldline_id";
    public static final String EXTRA_WORLDLINE_NAME = "worldline_name";
    private static final int REQUEST_PICK_IMAGE = 1001;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final List<Character> characters = new ArrayList<>();

    private ServerRecord server;
    private OkHttpClient client;
    private WebSocket socket;
    private String conversationId;
    private String characterName = "角色";
    private String preferredCharacterId = "";
    private String worldlineId = "";
    private String worldlineName = "";
    private JSONArray conversations;

    private boolean destroyed;
    private boolean reconnectScheduled;
    private int reconnectAttempts;
    private boolean streaming;
    private boolean waiting;
    private TextView streamingBubble;
    private TextView typingBubble;
    private final StringBuilder streamingText = new StringBuilder();
    private final Runnable reconnectTask = () -> {
        reconnectScheduled = false;
        connect();
    };

    private TextView statusView;
    private TextView modeButton;
    private TextView timeButton;
    private TextView batteryView;
    private boolean archived;
    private boolean awaitingChapters;
    private String explicitConversationId = "";
    private String conversationMode = "chat";
    private JSONArray effects = new JSONArray();
    private String timeMode = "real";
    private String timeText = "";
    private LinearLayout messageList;
    private LinearLayout inputBar;
    private HorizontalScrollView commandScroll;
    private LinearLayout commandRow;
    private final List<String> commandOptions = new ArrayList<>();
    private final Map<String, String> commandLabels = new HashMap<>();
    private ScrollView scroll;
    private EditText input;
    private ImageButton sendButton;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        String serverId = getIntent().getStringExtra(EXTRA_SERVER_ID);
        preferredCharacterId = getIntent().getStringExtra(EXTRA_CHARACTER_ID) == null
                ? "" : getIntent().getStringExtra(EXTRA_CHARACTER_ID);
        explicitConversationId = getIntent().getStringExtra(EXTRA_CONVERSATION_ID) == null
                ? "" : getIntent().getStringExtra(EXTRA_CONVERSATION_ID);
        String extraName = getIntent().getStringExtra(EXTRA_CHARACTER_NAME);
        if (extraName != null && !extraName.isEmpty()) characterName = extraName;
        worldlineId = getIntent().getStringExtra(EXTRA_WORLDLINE_ID) == null
                ? "" : getIntent().getStringExtra(EXTRA_WORLDLINE_ID);
        worldlineName = getIntent().getStringExtra(EXTRA_WORLDLINE_NAME) == null
                ? "" : getIntent().getStringExtra(EXTRA_WORLDLINE_NAME);
        server = new ServerStore(this).find(serverId);
        if (server == null) {
            finish();
            return;
        }
        buildUi();
        try {
            ChatService.start(this, server.id);
        } catch (Exception ignored) {
        }
        connect();
    }

    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.parseColor("#0B1220"));
        root.setPadding(dp(10), dp(10), dp(10), dp(10));

        LinearLayout head = new LinearLayout(this);
        head.setOrientation(LinearLayout.HORIZONTAL);
        head.setGravity(Gravity.CENTER_VERTICAL);

        statusView = new TextView(this);
        statusView.setTextColor(Color.parseColor("#9AA8BD"));
        statusView.setTextSize(12);
        statusView.setText("连接中…");
        statusView.setPadding(dp(4), 0, dp(4), dp(6));
        head.addView(statusView, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        modeButton = new TextView(this);
        modeButton.setText("聊天");
        modeButton.setTextColor(Color.parseColor("#9AA8BD"));
        modeButton.setTextSize(12);
        modeButton.setPadding(dp(8), dp(4), dp(4), dp(6));
        modeButton.setOnClickListener(view -> toggleMode());
        head.addView(modeButton, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        timeButton = new TextView(this);
        timeButton.setText("时间");
        timeButton.setTextColor(Color.parseColor("#9AA8BD"));
        timeButton.setTextSize(12);
        timeButton.setPadding(dp(8), dp(4), dp(4), dp(6));
        timeButton.setOnClickListener(view -> showTimeDialog());
        head.addView(timeButton, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        batteryView = new TextView(this);
        batteryView.setText("100%");
        batteryView.setTextColor(Color.parseColor("#57D68A"));
        batteryView.setTextSize(12);
        batteryView.setPadding(dp(8), dp(4), dp(4), dp(6));
        head.addView(batteryView, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        root.addView(head, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        messageList = new LinearLayout(this);
        messageList.setOrientation(LinearLayout.VERTICAL);
        messageList.setPadding(dp(2), dp(4), dp(2), dp(4));

        scroll = new ScrollView(this);
        scroll.addView(messageList, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        root.addView(scroll, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        inputBar = bar;

        commandRow = new LinearLayout(this);
        commandRow.setOrientation(LinearLayout.HORIZONTAL);
        commandRow.setPadding(0, dp(2), 0, dp(2));
        commandScroll = new HorizontalScrollView(this);
        commandScroll.setHorizontalScrollBarEnabled(false);
        commandScroll.addView(commandRow);
        commandScroll.setVisibility(View.GONE);
        root.addView(commandScroll, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        input = new EditText(this);
        input.setHint("说点什么");
        input.setTextColor(Color.parseColor("#EEF2F8"));
        input.setHintTextColor(Color.parseColor("#66748A"));
        input.setBackgroundColor(Color.parseColor("#151D2C"));
        input.setPadding(dp(10), dp(6), dp(10), dp(6));
        input.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence value, int start, int count, int after) {}
            @Override public void onTextChanged(CharSequence value, int start, int before, int count) {}
            @Override public void afterTextChanged(Editable value) {
                updateCommandSuggestions();
            }
        });
        bar.addView(input, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        ImageButton imageButton = new ImageButton(this);
        imageButton.setImageResource(R.drawable.ic_photo);
        imageButton.setBackgroundColor(Color.TRANSPARENT);
        imageButton.setContentDescription("发送图片");
        imageButton.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
        imageButton.setPadding(dp(10), dp(8), dp(10), dp(8));
        imageButton.setOnClickListener(view -> pickImage());
        LinearLayout.LayoutParams imageButtonParams = new LinearLayout.LayoutParams(dp(44), dp(44));
        imageButtonParams.leftMargin = dp(6);
        bar.addView(imageButton, imageButtonParams);

        sendButton = new ImageButton(this);
        sendButton.setImageResource(R.drawable.ic_send_enter);
        sendButton.setBackgroundColor(Color.TRANSPARENT);
        sendButton.setContentDescription("发送");
        sendButton.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
        sendButton.setPadding(dp(10), dp(8), dp(10), dp(8));
        setSendEnabled(false);
        sendButton.setOnClickListener(view -> send());
        LinearLayout.LayoutParams buttonParams = new LinearLayout.LayoutParams(dp(44), dp(44));
        buttonParams.leftMargin = dp(2);
        bar.addView(sendButton, buttonParams);

        root.addView(bar, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        setContentView(root);
        if (getSupportActionBar() != null) {
            getSupportActionBar().setTitle(server.name);
        }
    }

    private void connect() {
        if (destroyed) return;
        try {
            client = buildClient(server);
        } catch (Exception error) {
            status("证书加载失败：" + error.getMessage());
            return;
        }
        String url = "wss://" + server.host + ":" + server.port + "/ws?token=" + server.token;
        Request request = new Request.Builder().url(url).build();
        status("连接中…");
        socket = client.newWebSocket(request, new WebSocketListener() {
            @Override
            public void onOpen(WebSocket webSocket, Response response) {
                main.post(() -> {
                    reconnectAttempts = 0;
                    status("已连接，准备角色…");
                });
            }

            @Override
            public void onMessage(WebSocket webSocket, String text) {
                main.post(() -> handle(text));
            }

            @Override
            public void onFailure(WebSocket webSocket, Throwable error, Response response) {
                main.post(() -> {
                    status("连接失败：" + shortMessage(error));
                    scheduleReconnect();
                });
            }

            @Override
            public void onClosed(WebSocket webSocket, int code, String reason) {
                main.post(() -> {
                    status("连接已关闭" + (reason == null || reason.isEmpty() ? "" : "：" + reason));
                    scheduleReconnect();
                });
            }
        });
    }

    private void scheduleReconnect() {
        if (destroyed || reconnectScheduled) return;
        reconnectScheduled = true;
        reconnectAttempts += 1;
        long delay = Math.min(30000L, 2000L * (1L << Math.min(reconnectAttempts - 1, 4)));
        status("连接断开，" + (delay / 1000) + " 秒后重连…");
        main.postDelayed(reconnectTask, delay);
    }

    private void handle(String text) {
        JSONObject frame;
        try {
            frame = new JSONObject(text);
        } catch (Exception error) {
            return;
        }
        String type = frame.optString("type", "");
        switch (type) {
            case "ready":
                onReady(frame);
                break;
            case "conversation.created":
                conversationId = conversationId(frame);
                if (!conversationId.isEmpty()) {
                    clearMessages();
                    waiting = false;
                    applyTime(frame);
                    applyMode(frame);
                    applyChapter(frame);
                    applyEffects(frame);
                }
                break;
            case "conversation.opened":
                conversationId = conversationId(frame);
                if (!conversationId.isEmpty()) {
                    clearMessages();
                    JSONArray history = frame.optJSONArray("history");
                    if (history != null) {
                        for (int index = 0; index < history.length(); index += 1) {
                            JSONObject item = history.optJSONObject(index);
                            if (item == null) continue;
                            String body = item.optString("text", "");
                            if (isContextLeak(body)) continue;
                            String role = item.optString("role", "");
                            if (item.has("image")) {
                                if (item.optBoolean("sticker", false)) appendSticker(item.optString("image", ""));
                                else appendImage(item.optString("image", ""), "user".equals(role));
                            }
                            else if ("system".equals(role)) appendSystem(body);
                            else appendMessage("user".equals(role), body);
                        }
                    }
                    status("已连接 · " + characterName);
                    waiting = false;
                    applyTime(frame);
                    applyMode(frame);
                    applyChapter(frame);
                    applyEffects(frame);
                }
                break;
            case "assistant.typing":
                showTyping(frame.optBoolean("active", false), frame.optString("label", ""));
                break;
            case "assistant.bubble":
                hideTyping();
                appendMessage(false, frame.optString("text", ""));
                break;
            case "assistant.delta":
                hideTyping();
                appendDelta(frame.optString("text", ""));
                break;
            case "assistant.done":
                hideTyping();
                streaming = false;
                streamingBubble = null;
                streamingText.setLength(0);
                waiting = false;
                setSendEnabled(!archived && conversationId != null && !conversationId.isEmpty());
                break;
            case "battery.updated":
                applyBattery(frame.optInt("battery", 100));
                break;
            case "effect.updated":
                effects = frame.optJSONArray("effects") == null ? new JSONArray() : frame.optJSONArray("effects");
                break;
            case "command.applied":
                hideTyping();
                waiting = false;
                appendSystem(frame.optString("text", ""));
                effects = frame.optJSONArray("effects") == null ? effects : frame.optJSONArray("effects");
                setSendEnabled(!archived && conversationId != null && !conversationId.isEmpty());
                break;
            case "assistant.image":
                hideTyping();
                appendImage(frame.optString("mediaId", ""), false);
                break;
            case "assistant.sticker":
                hideTyping();
                appendSticker(frame.optString("mediaId", ""));
                break;
            case "assistant.image.failed":
                appendSystem(frame.optString("text", "照片没有发出去。"));
                break;
            case "chapter.list":
                conversations = frame.optJSONArray("conversations");
                if (awaitingChapters) {
                    awaitingChapters = false;
                    showChapterDialog(conversations);
                }
                break;
            case "mode.updated":
                conversationMode = frame.optString("mode", "chat");
                updateModeButton();
                Toast.makeText(this, "meeting".equals(conversationMode) ? "已切换到见面模式" : "已切换到聊天模式", Toast.LENGTH_SHORT).show();
                break;
            case "time.updated":
                timeMode = frame.optString("mode", "real");
                timeText = frame.optString("time", "");
                updateTimeButton();
                Toast.makeText(this, timeText, Toast.LENGTH_SHORT).show();
                break;
            case "error":
                hideTyping();
                waiting = false;
                setSendEnabled(conversationId != null && !conversationId.isEmpty());
                status("出错：" + frame.optString("error", "未知错误"));
                break;
            default:
                break;
        }
    }

    private String conversationId(JSONObject frame) {
        JSONObject conversation = frame.optJSONObject("conversation");
        return conversation == null ? "" : conversation.optString("id", "");
    }

    private boolean isContextLeak(String text) {
        return text.startsWith("Current runtime context")
                || text.startsWith("Time sampled while preparing turn")
                || text.contains("Earlier runtime-context snapshots no longer apply");
    }

    private void onReady(JSONObject frame) {
        characters.clear();
        conversations = frame.optJSONArray("conversations");
        parseCommands(frame);
        JSONArray array = frame.optJSONArray("characters");
        if (array != null) {
            for (int index = 0; index < array.length(); index += 1) {
                JSONObject item = array.optJSONObject(index);
                if (item == null) continue;
                characters.add(new Character(item.optString("id", ""), item.optString("name", "角色")));
            }
        }
        if (characters.isEmpty()) {
            status("电脑端还没有角色");
            return;
        }
        Character preferred = null;
        for (Character character : characters) {
            if (character.id.equals(preferredCharacterId)) {
                preferred = character;
                break;
            }
        }
        if (preferred != null) characterName = preferred.name;
        if (!explicitConversationId.isEmpty()) {
            JSONObject request = new JSONObject();
            try {
                request.put("type", "conversation.open");
                request.put("conversationId", explicitConversationId);
            } catch (Exception ignored) {
            }
            socket.send(request.toString());
            return;
        }
        if (preferred != null) {
            selectCharacter(preferred);
            return;
        }
        if (characters.size() == 1) {
            selectCharacter(characters.get(0));
            return;
        }
        String[] names = new String[characters.size()];
        for (int index = 0; index < characters.size(); index += 1) names[index] = characters.get(index).name;
        new AlertDialog.Builder(this)
                .setTitle("选择角色")
                .setItems(names, (dialog, which) -> selectCharacter(characters.get(which)))
                .setCancelable(false)
                .show();
    }

    private void selectCharacter(Character character) {
        characterName = character.name;
        preferredCharacterId = character.id;
        try {
            ChatService.start(this, server.id, character.id);
        } catch (Exception ignored) {
        }
        if (getSupportActionBar() != null) {
            getSupportActionBar().setTitle(server.name + " · " + characterName + (worldlineName.isEmpty() ? "" : " · " + worldlineName));
        }
        String existing = "";
        if (conversations != null) {
            for (int index = 0; index < conversations.length(); index += 1) {
                JSONObject item = conversations.optJSONObject(index);
                if (item == null) continue;
                if (!character.id.equals(item.optString("characterId", ""))) continue;
                if (!worldlineId.isEmpty() && !worldlineId.equals(item.optString("worldlineId", ""))) continue;
                if (item.optBoolean("archived") || "archived".equals(item.optString("status", ""))) continue;
                existing = item.optString("id", "");
                break;
            }
        }
        JSONObject request = new JSONObject();
        try {
            if (!existing.isEmpty()) {
                request.put("type", "conversation.open");
                request.put("conversationId", existing);
            } else {
                request.put("type", "conversation.create");
                request.put("characterId", character.id);
                if (!worldlineId.isEmpty()) request.put("worldlineId", worldlineId);
            }
        } catch (Exception ignored) {
        }
        socket.send(request.toString());
    }

    @Override
    public boolean onCreateOptionsMenu(Menu menu) {
        menu.add(0, 1, 0, "章节");
        menu.add(0, 2, 1, "新章节");
        menu.add(0, 3, 2, "状态");
        return true;
    }

    @Override
    public boolean onOptionsItemSelected(MenuItem item) {
        if (item.getItemId() == 1) {
            showChapters();
            return true;
        }
        if (item.getItemId() == 2) {
            newChapter();
            return true;
        }
        if (item.getItemId() == 3) {
            showEffects();
            return true;
        }
        return super.onOptionsItemSelected(item);
    }

    private void applyChapter(JSONObject frame) {
        JSONObject conversation = frame.optJSONObject("conversation");
        if (conversation == null) return;
        archived = conversation.optBoolean("archived")
                || "archived".equals(conversation.optString("status", ""));
        int index = conversation.optInt("index", 0);
        String lineId = conversation.optString("worldlineId", "");
        if (!lineId.isEmpty()) worldlineId = lineId;
        String lineName = conversation.optString("worldlineName", "");
        if (!lineName.isEmpty()) worldlineName = lineName;
        applyBattery(conversation.optInt("battery", 100));
        if (archived) {
            input.setEnabled(false);
            setSendEnabled(false);
            if (inputBar != null) inputBar.setVisibility(View.GONE);
            if (commandScroll != null) commandScroll.setVisibility(View.GONE);
            modeButton.setVisibility(View.GONE);
            timeButton.setVisibility(View.GONE);
            status("第" + index + "章 · 已归档 · 只读");
            if (getSupportActionBar() != null) {
                getSupportActionBar().setTitle(characterName + (worldlineName.isEmpty() ? "" : " · " + worldlineName) + " · 第" + index + "章");
            }
        } else {
            input.setEnabled(true);
            setSendEnabled(!waiting);
            if (inputBar != null) inputBar.setVisibility(View.VISIBLE);
            modeButton.setVisibility(View.VISIBLE);
            timeButton.setVisibility(View.VISIBLE);
            status("已连接 · " + characterName);
            if (getSupportActionBar() != null) {
                getSupportActionBar().setTitle(server.name + " · " + characterName + (worldlineName.isEmpty() ? "" : " · " + worldlineName) + (index > 0 ? " · 第" + index + "章" : ""));
            }
        }
    }

    private void applyBattery(int battery) {
        int clamped = Math.max(1, Math.min(100, battery));
        if (batteryView != null) {
            batteryView.setText(clamped + "%");
            if (clamped <= 20) {
                batteryView.setTextColor(Color.parseColor("#FF7B8A"));
            } else if (clamped <= 60) {
                batteryView.setTextColor(Color.parseColor("#F5C451"));
            } else {
                batteryView.setTextColor(Color.parseColor("#57D68A"));
            }
        }
        maybeBatteryPopup(clamped);
    }

    private void maybeBatteryPopup(int battery) {
        if (archived || battery > 20 || conversationId == null || conversationId.isEmpty()) return;
        SharedPreferences preferences = getSharedPreferences("rplink_battery", MODE_PRIVATE);
        String key = "shown_" + conversationId;
        if (preferences.getBoolean(key, false)) return;
        preferences.edit().putBoolean(key, true).apply();
        new AlertDialog.Builder(this)
                .setTitle("电量偏低")
                .setMessage("电量偏低，请及时充电。")
                .setPositiveButton("知道了", null)
                .show();
    }

    private void parseCommands(JSONObject frame) {
        commandOptions.clear();
        commandLabels.clear();
        JSONArray commands = frame.optJSONArray("commands");
        if (commands != null) {
            for (int index = 0; index < commands.length(); index += 1) {
                JSONObject item = commands.optJSONObject(index);
                if (item == null) continue;
                String command = item.optString("command", "");
                if (command.isEmpty()) continue;
                commandOptions.add(command);
                String name = item.optString("name", "");
                int duration = item.optInt("durationTurns", -1);
                commandLabels.put(command, name + (duration > 0 ? " · " + duration + " 轮" : ""));
            }
        }
        updateCommandSuggestions();
    }

    private void updateCommandSuggestions() {
        if (commandScroll == null || commandRow == null || input == null) return;
        String value = input.getText().toString();
        if (!value.startsWith("/") || value.contains(" ") || commandOptions.isEmpty()) {
            commandScroll.setVisibility(View.GONE);
            return;
        }
        String prefix = value.substring(1).toLowerCase(Locale.ROOT);
        commandRow.removeAllViews();
        int matches = 0;
        for (String command : commandOptions) {
            String bare = command.startsWith("/") ? command.substring(1) : command;
            if (!bare.toLowerCase(Locale.ROOT).startsWith(prefix)) continue;
            TextView chip = new TextView(this);
            String label = commandLabels.get(command);
            chip.setText(command + (label == null || label.isEmpty() ? "" : "  " + label));
            chip.setTextSize(12);
            chip.setTextColor(Color.parseColor("#CFE0FF"));
            chip.setPadding(dp(10), dp(5), dp(10), dp(5));
            GradientDrawable background = new GradientDrawable();
            background.setColor(Color.parseColor("#1B2A44"));
            background.setCornerRadius(dp(12));
            chip.setBackground(background);
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            params.rightMargin = dp(6);
            chip.setLayoutParams(params);
            chip.setOnClickListener(view -> {
                input.setText(command + " ");
                input.setSelection(input.getText().length());
                input.requestFocus();
                commandScroll.setVisibility(View.GONE);
            });
            commandRow.addView(chip);
            matches += 1;
        }
        commandScroll.setVisibility(matches > 0 ? View.VISIBLE : View.GONE);
    }

    private void applyEffects(JSONObject frame) {
        JSONObject conversation = frame.optJSONObject("conversation");
        if (conversation == null) return;
        JSONArray value = conversation.optJSONArray("effects");
        effects = value == null ? new JSONArray() : value;
    }

    private void showEffects() {
        if (effects == null) effects = new JSONArray();
        List<JSONObject> list = new ArrayList<>();
        List<String> labels = new ArrayList<>();
        for (int index = 0; index < effects.length(); index += 1) {
            JSONObject item = effects.optJSONObject(index);
            if (item == null) continue;
            list.add(item);
            int remaining = item.optInt("remainingTurns", -1);
            labels.add(item.optString("label", "状态") + (remaining >= 0 ? " · 剩余 " + remaining + " 轮" : " · 持续"));
        }
        if (!archived) {
            list.add(null);
            labels.add("添加效果…");
        }
        if (labels.isEmpty()) {
            Toast.makeText(this, "当前没有状态效果", Toast.LENGTH_SHORT).show();
            return;
        }
        new AlertDialog.Builder(this)
                .setTitle("当前状态")
                .setItems(labels.toArray(new String[0]), (dialog, which) -> {
                    if (list.get(which) == null) addEffect();
                    else removeEffect(list.get(which));
                })
                .setNegativeButton("关闭", null)
                .show();
    }

    private void addEffect() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(12), dp(8), dp(12), dp(8));
        EditText label = new EditText(this);
        label.setHint("名称，例如：催眠");
        EditText prompt = new EditText(this);
        prompt.setHint("状态描述：感受/冲动，不改变核心人格");
        prompt.setMinLines(3);
        EditText turns = new EditText(this);
        turns.setHint("持续轮数（留空为持续）");
        turns.setInputType(android.text.InputType.TYPE_CLASS_NUMBER);
        box.addView(label);
        box.addView(prompt);
        box.addView(turns);
        new AlertDialog.Builder(this)
                .setTitle("添加状态效果")
                .setView(box)
                .setNegativeButton("取消", null)
                .setPositiveButton("添加", (dialog, which) -> {
                    if (socket == null) return;
                    JSONObject frame = new JSONObject();
                    try {
                        frame.put("type", "effect.add");
                        frame.put("conversationId", conversationId);
                        frame.put("label", label.getText().toString().trim());
                        frame.put("prompt", prompt.getText().toString().trim());
                        String rawTurns = turns.getText().toString().trim();
                        if (!rawTurns.isEmpty()) frame.put("remainingTurns", Integer.parseInt(rawTurns));
                        frame.put("intensity", 0.6);
                    } catch (Exception ignored) {
                    }
                    socket.send(frame.toString());
                })
                .show();
    }

    private void removeEffect(JSONObject effect) {
        String id = effect.optString("id", "");
        if (id.isEmpty()) return;
        new AlertDialog.Builder(this)
                .setTitle("移除状态")
                .setMessage(effect.optString("label", "状态"))
                .setNegativeButton("取消", null)
                .setPositiveButton("移除", (dialog, which) -> {
                    if (socket == null) return;
                    JSONObject frame = new JSONObject();
                    try {
                        frame.put("type", "effect.remove");
                        frame.put("conversationId", conversationId);
                        frame.put("effectId", id);
                    } catch (Exception ignored) {
                    }
                    socket.send(frame.toString());
                })
                .show();
    }

    private void showChapters() {
        if (socket == null) return;
        awaitingChapters = true;
        JSONObject frame = new JSONObject();
        try {
            frame.put("type", "chapter.list");
            frame.put("characterId", preferredCharacterId);
            if (!worldlineId.isEmpty()) frame.put("worldlineId", worldlineId);
        } catch (Exception ignored) {
        }
        socket.send(frame.toString());
    }

    private void showChapterDialog(JSONArray list) {
        if (list == null) return;
        List<JSONObject> chapters = new ArrayList<>();
        List<String> labels = new ArrayList<>();
        for (int index = 0; index < list.length(); index += 1) {
            JSONObject item = list.optJSONObject(index);
            if (item == null) continue;
            if (!preferredCharacterId.isEmpty()
                    && !preferredCharacterId.equals(item.optString("characterId", ""))) continue;
            if (!worldlineId.isEmpty() && !worldlineId.equals(item.optString("worldlineId", ""))) continue;
            boolean archivedItem = item.optBoolean("archived")
                    || "archived".equals(item.optString("status", ""));
            int number = item.optInt("index", 0);
            chapters.add(item);
            labels.add("第" + number + "章 · " + (archivedItem ? "已归档" : "当前"));
        }
        if (chapters.isEmpty()) {
            Toast.makeText(this, "还没有章节", Toast.LENGTH_SHORT).show();
            return;
        }
        new AlertDialog.Builder(this)
                .setTitle("章节")
                .setItems(labels.toArray(new String[0]), (dialog, which) -> openChapter(chapters.get(which)))
                .setNegativeButton("取消", null)
                .show();
    }

    private void openChapter(JSONObject chapter) {
        String id = chapter.optString("id", "");
        if (id.isEmpty() || id.equals(conversationId)) return;
        Intent intent = new Intent(this, ChatActivity.class);
        intent.putExtra(EXTRA_SERVER_ID, server.id);
        intent.putExtra(EXTRA_CHARACTER_ID, chapter.optString("characterId", preferredCharacterId));
        intent.putExtra(EXTRA_CHARACTER_NAME, characterName);
        intent.putExtra(EXTRA_WORLDLINE_ID, worldlineId);
        intent.putExtra(EXTRA_WORLDLINE_NAME, worldlineName);
        intent.putExtra(EXTRA_CONVERSATION_ID, id);
        startActivity(intent);
    }

    private void newChapter() {
        EditText summaryInput = new EditText(this);
        summaryInput.setHint("前情（可选）");
        summaryInput.setMinLines(3);
        summaryInput.setPadding(dp(12), dp(8), dp(12), dp(8));
        new AlertDialog.Builder(this)
                .setTitle("开始新章节")
                .setView(summaryInput)
                .setNegativeButton("取消", null)
                .setPositiveButton("新章节", (dialog, which) -> {
                    if (socket == null) return;
                    JSONObject frame = new JSONObject();
                    try {
                        frame.put("type", "chapter.new");
                        frame.put("characterId", preferredCharacterId);
                        if (!worldlineId.isEmpty()) frame.put("worldlineId", worldlineId);
                        frame.put("summary", summaryInput.getText().toString().trim());
                    } catch (Exception ignored) {
                    }
                    socket.send(frame.toString());
                })
                .show();
    }

    private void pickImage() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("image/*");
        try {
            startActivityForResult(intent, REQUEST_PICK_IMAGE);
        } catch (Exception error) {
            Toast.makeText(this, "无法打开图片选择器", Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQUEST_PICK_IMAGE || resultCode != RESULT_OK || data == null) return;
        Uri uri = data.getData();
        if (uri == null) return;
        if (waiting || archived) {
            Toast.makeText(this, "等当前回复结束后再发图片", Toast.LENGTH_SHORT).show();
            return;
        }
        Bitmap bitmap = loadImageForUpload(uri);
        if (bitmap == null) {
            Toast.makeText(this, "图片读取失败", Toast.LENGTH_SHORT).show();
            return;
        }
        appendLocalImage(bitmap);
        String caption = input.getText().toString().trim();
        if (!caption.isEmpty()) appendMessage(true, caption);
        sendImageMessage(bitmap, caption);
    }

    private Bitmap loadImageForUpload(Uri uri) {
        try {
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            try (InputStream stream = getContentResolver().openInputStream(uri)) {
                BitmapFactory.decodeStream(stream, null, bounds);
            }
            int sample = 1;
            int maxEdge = 1024;
            while (bounds.outWidth / sample > maxEdge || bounds.outHeight / sample > maxEdge) sample *= 2;
            BitmapFactory.Options options = new BitmapFactory.Options();
            options.inSampleSize = sample;
            Bitmap bitmap;
            try (InputStream stream = getContentResolver().openInputStream(uri)) {
                bitmap = BitmapFactory.decodeStream(stream, null, options);
            }
            if (bitmap == null) return null;
            int edge = Math.max(bitmap.getWidth(), bitmap.getHeight());
            if (edge > maxEdge) {
                float scale = maxEdge / (float) edge;
                Bitmap scaled = Bitmap.createScaledBitmap(
                        bitmap,
                        Math.max(1, Math.round(bitmap.getWidth() * scale)),
                        Math.max(1, Math.round(bitmap.getHeight() * scale)),
                        true);
                if (scaled != bitmap) bitmap.recycle();
                bitmap = scaled;
            }
            return bitmap;
        } catch (Exception error) {
            return null;
        }
    }

    private void sendImageMessage(Bitmap bitmap, String caption) {
        if (socket == null || conversationId == null || conversationId.isEmpty() || waiting || archived) return;
        try {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            bitmap.compress(Bitmap.CompressFormat.JPEG, 85, buffer);
            byte[] bytes = buffer.toByteArray();
            if (bytes.length > 4 * 1024 * 1024) {
                Toast.makeText(this, "图片太大", Toast.LENGTH_SHORT).show();
                return;
            }
            String encoded = Base64.encodeToString(bytes, Base64.NO_WRAP);
            JSONObject image = new JSONObject();
            image.put("data", encoded);
            image.put("mediaType", "image/jpeg");
            image.put("name", "photo.jpg");
            JSONObject frame = new JSONObject();
            frame.put("type", "message.send");
            frame.put("conversationId", conversationId);
            frame.put("text", caption);
            frame.put("clientId", UUID.randomUUID().toString());
            frame.put("image", image);
            waiting = true;
            setSendEnabled(false);
            input.setText("");
            socket.send(frame.toString());
        } catch (Exception error) {
            Toast.makeText(this, "图片发送失败", Toast.LENGTH_SHORT).show();
        }
    }

    private void setSendEnabled(boolean enabled) {
        if (sendButton == null) return;
        sendButton.setEnabled(enabled);
        sendButton.setAlpha(enabled ? 1f : 0.4f);
    }

    private void send() {
        if (waiting || archived) return;
        String text = input.getText().toString().trim();
        if (text.isEmpty() || socket == null || conversationId == null || conversationId.isEmpty()) return;
        waiting = true;
        setSendEnabled(false);
        input.setText("");
        appendMessage(true, text);
        JSONObject frame = new JSONObject();
        try {
            frame.put("type", "message.send");
            frame.put("conversationId", conversationId);
            frame.put("text", text);
            frame.put("clientId", String.valueOf(System.currentTimeMillis()));
        } catch (Exception ignored) {
        }
        socket.send(frame.toString());
    }

    private void appendDelta(String delta) {
        if (delta.isEmpty()) return;
        if (!streaming || streamingBubble == null) {
            streaming = true;
            streamingText.setLength(0);
            streamingBubble = appendBubble(false, "");
        }
        streamingText.append(delta);
        streamingBubble.setText(streamingText.toString());
        scrollDown();
    }

    private void showTyping(boolean active, String label) {
        if (active) {
            String text = label == null ? "" : label.trim();
            if (typingBubble != null) {
                if (!text.isEmpty()) typingBubble.setText(text);
                return;
            }
            typingBubble = appendBubble(false, text.isEmpty() ? "…" : text);
        } else {
            hideTyping();
        }
    }

    private void hideTyping() {
        if (typingBubble == null) return;
        View parent = (View) typingBubble.getParent();
        if (parent != null) messageList.removeView(parent);
        typingBubble = null;
    }

    private void appendMessage(boolean user, String text) {
        if (text == null || text.isEmpty()) return;
        appendBubble(user, text);
    }

    private void appendSystem(String text) {
        if (text == null || text.isEmpty()) return;
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextColor(Color.parseColor("#9AA8BD"));
        view.setTextSize(12);
        view.setGravity(Gravity.CENTER);
        view.setPadding(dp(10), dp(6), dp(10), dp(6));
        messageList.addView(view, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        scrollDown();
    }

    private ImageView createImageRow(boolean user, boolean sticker) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(user ? Gravity.END : Gravity.START);
        row.setPadding(0, dp(3), 0, dp(3));
        ImageView imageView = new ImageView(this);
        imageView.setAdjustViewBounds(true);
        imageView.setScaleType(ImageView.ScaleType.FIT_CENTER);
        if (!sticker) imageView.setBackgroundColor(Color.parseColor("#151D2C"));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                dp(sticker ? 150 : 240), dp(sticker ? 150 : 320));
        row.addView(imageView, params);
        messageList.addView(row, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        imageView.setOnLongClickListener(view -> {
            showImageActions(imageView);
            return true;
        });
        scrollDown();
        return imageView;
    }

    private void fitImage(ImageView imageView, Bitmap bitmap, boolean user, boolean sticker) {
        int maxWidth = dp(sticker ? 150 : (user ? 220 : 260));
        int targetWidth = Math.min(maxWidth, bitmap.getWidth());
        int targetHeight = Math.max(1, Math.round(targetWidth * (float) bitmap.getHeight() / bitmap.getWidth()));
        imageView.setImageBitmap(bitmap);
        imageView.setLayoutParams(new LinearLayout.LayoutParams(targetWidth, targetHeight));
        scrollDown();
    }

    private void appendLocalImage(Bitmap bitmap) {
        if (bitmap == null) return;
        ImageView imageView = createImageRow(true, false);
        fitImage(imageView, bitmap, true, false);
    }

    private void appendImage(String mediaId, boolean user) {
        appendRemoteImage(mediaId, user, false);
    }

    private void appendSticker(String mediaId) {
        appendRemoteImage(mediaId, false, true);
    }

    private void appendRemoteImage(String mediaId, boolean user, boolean sticker) {
        if (mediaId == null || mediaId.isEmpty() || server == null || client == null) return;
        ImageView imageView = createImageRow(user, sticker);
        String url = "https://" + server.host + ":" + server.port + "/media/" + mediaId + ".png";
        Request request = new Request.Builder()
                .url(url)
                .header("X-Rp-Token", server.token)
                .build();
        client.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(Call call, java.io.IOException error) {
                main.post(() -> appendSystem(sticker ? "表情包加载失败" : "图片加载失败"));
            }

            @Override
            public void onResponse(Call call, Response response) {
                try (Response body = response) {
                    if (!body.isSuccessful() || body.body() == null) {
                        main.post(() -> appendSystem(sticker ? "表情包加载失败" : "图片加载失败"));
                        return;
                    }
                    byte[] bytes = body.body().bytes();
                    Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
                    if (bitmap == null) {
                        main.post(() -> appendSystem("图片解码失败"));
                        return;
                    }
                    main.post(() -> fitImage(imageView, bitmap, user, sticker));
                } catch (Exception error) {
                    main.post(() -> appendSystem("图片加载失败"));
                }
            }
        });
    }

    private void showImageActions(ImageView imageView) {
        new AlertDialog.Builder(this)
                .setTitle("图片")
                .setItems(new String[]{"保存到相册"}, (dialog, which) -> saveImage(imageView))
                .setNegativeButton("取消", null)
                .show();
    }

    private void saveImage(ImageView imageView) {
        Drawable drawable = imageView.getDrawable();
        if (!(drawable instanceof BitmapDrawable)) {
            Toast.makeText(this, "图片还没加载好", Toast.LENGTH_SHORT).show();
            return;
        }
        Bitmap bitmap = ((BitmapDrawable) drawable).getBitmap();
        Toast.makeText(this, "正在保存…", Toast.LENGTH_SHORT).show();
        new Thread(() -> {
            boolean saved = saveBitmapToGallery(bitmap);
            main.post(() -> Toast.makeText(
                    this,
                    saved ? "已保存到相册：Pictures/RPLink" : "保存失败",
                    Toast.LENGTH_SHORT
            ).show());
        }).start();
    }

    private boolean saveBitmapToGallery(Bitmap bitmap) {
        String name = "rplink_" + System.currentTimeMillis() + ".png";
        ContentValues values = new ContentValues();
        values.put(MediaStore.Images.Media.DISPLAY_NAME, name);
        values.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
        values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/RPLink");
        values.put(MediaStore.Images.Media.IS_PENDING, 1);
        Uri uri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
        if (uri == null) return false;
        try (OutputStream stream = getContentResolver().openOutputStream(uri)) {
            if (stream == null || !bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream)) {
                getContentResolver().delete(uri, null, null);
                return false;
            }
        } catch (Exception error) {
            getContentResolver().delete(uri, null, null);
            return false;
        }
        ContentValues done = new ContentValues();
        done.put(MediaStore.Images.Media.IS_PENDING, 0);
        getContentResolver().update(uri, done, null, null);
        return true;
    }

    private TextView appendBubble(boolean user, String text) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(user ? Gravity.END : Gravity.START);
        row.setPadding(0, dp(3), 0, dp(3));

        TextView bubble = new TextView(this);
        bubble.setText(text);
        bubble.setTextColor(Color.parseColor("#EEF2F8"));
        bubble.setTextSize(15);
        bubble.setLineSpacing(dp(3), 1f);
        bubble.setPadding(dp(12), dp(8), dp(12), dp(8));
        bubble.setMaxWidth((int) (getResources().getDisplayMetrics().widthPixels * 0.78f));
        GradientDrawable background = new GradientDrawable();
        background.setColor(Color.parseColor(user ? "#2F4B8F" : "#1B2436"));
        background.setCornerRadius(dp(16));
        bubble.setBackground(background);
        row.addView(bubble, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        messageList.addView(row, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        scrollDown();
        return bubble;
    }

    private void clearMessages() {
        messageList.removeAllViews();
        typingBubble = null;
        streaming = false;
        streamingBubble = null;
        streamingText.setLength(0);
    }

    private void applyMode(JSONObject frame) {
        JSONObject conversation = frame.optJSONObject("conversation");
        if (conversation != null) conversationMode = conversation.optString("mode", "chat");
        updateModeButton();
    }

    private void updateModeButton() {
        if (modeButton != null) {
            modeButton.setText("meeting".equals(conversationMode) ? "见面" : "聊天");
        }
    }

    private void toggleMode() {
        if (socket == null || conversationId == null || conversationId.isEmpty()) return;
        String next = "meeting".equals(conversationMode) ? "chat" : "meeting";
        JSONObject frame = new JSONObject();
        try {
            frame.put("type", "mode.set");
            frame.put("conversationId", conversationId);
            frame.put("mode", next);
        } catch (Exception ignored) {
        }
        socket.send(frame.toString());
    }

    private void applyTime(JSONObject frame) {
        JSONObject conversation = frame.optJSONObject("conversation");
        if (conversation != null) timeMode = conversation.optString("timeMode", "real");
        String text = frame.optString("time", "");
        if (!text.isEmpty()) timeText = text;
        updateTimeButton();
    }

    private void updateTimeButton() {
        if (timeButton != null) {
            timeButton.setText("world".equals(timeMode) ? "世界时间" : "真实时间");
        }
    }

    private void showTimeDialog() {
        new AlertDialog.Builder(this)
                .setTitle(timeText.isEmpty() ? "时间设置" : "时间设置 · " + timeText)
                .setItems(new String[]{"跟随真实时间", "设置故事世界时间…"}, (dialog, which) -> {
                    if (which == 0) {
                        sendTime("real", 0L);
                    } else {
                        pickWorldTime();
                    }
                })
                .setNegativeButton("取消", null)
                .show();
    }

    private void pickWorldTime() {
        Calendar calendar = Calendar.getInstance();
        new DatePickerDialog(this, (datePicker, year, month, day) -> {
            calendar.set(Calendar.YEAR, year);
            calendar.set(Calendar.MONTH, month);
            calendar.set(Calendar.DAY_OF_MONTH, day);
            new TimePickerDialog(this, (timePicker, hour, minute) -> {
                calendar.set(Calendar.HOUR_OF_DAY, hour);
                calendar.set(Calendar.MINUTE, minute);
                calendar.set(Calendar.SECOND, 0);
                sendTime("world", calendar.getTimeInMillis());
            }, calendar.get(Calendar.HOUR_OF_DAY), calendar.get(Calendar.MINUTE), true).show();
        }, calendar.get(Calendar.YEAR), calendar.get(Calendar.MONTH), calendar.get(Calendar.DAY_OF_MONTH)).show();
    }

    private void sendTime(String mode, long worldTimeMs) {
        if (socket == null || conversationId == null || conversationId.isEmpty()) return;
        JSONObject frame = new JSONObject();
        try {
            frame.put("type", "time.set");
            frame.put("conversationId", conversationId);
            frame.put("mode", mode);
            if ("world".equals(mode)) frame.put("worldTimeMs", worldTimeMs);
        } catch (Exception ignored) {
        }
        socket.send(frame.toString());
    }

    private void scrollDown() {
        scroll.post(() -> scroll.fullScroll(View.FOCUS_DOWN));
    }

    private void status(String text) {
        statusView.setText(text);
    }

    private OkHttpClient buildClient(ServerRecord record) throws Exception {
        X509Certificate ca = TlsSupport.parseCertificate(record.caPem);
        SSLContext context = TlsSupport.pinnedContext(ca);
        KeyStore keyStore = KeyStore.getInstance(KeyStore.getDefaultType());
        keyStore.load(null, null);
        keyStore.setCertificateEntry("rplink-ca", ca);
        TrustManagerFactory factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        factory.init(keyStore);
        X509TrustManager manager = (X509TrustManager) factory.getTrustManagers()[0];
        return new OkHttpClient.Builder()
                .sslSocketFactory(context.getSocketFactory(), manager)
                .hostnameVerifier((hostname, session) -> true)
                .connectTimeout(10, TimeUnit.SECONDS)
                .readTimeout(0, TimeUnit.MILLISECONDS)
                .build();
    }

    private String shortMessage(Throwable error) {
        String message = error == null ? "" : error.getMessage();
        if (message == null || message.isEmpty()) return error == null ? "未知错误" : error.getClass().getSimpleName();
        return message;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private static final class Character {
        final String id;
        final String name;

        Character(String id, String name) {
            this.id = id;
            this.name = name;
        }
    }

    @Override
    protected void onDestroy() {
        destroyed = true;
        main.removeCallbacks(reconnectTask);
        ChatService.stop(this);
        if (socket != null) socket.close(1000, "bye");
        if (client != null) client.dispatcher().executorService().shutdown();
        super.onDestroy();
    }
}
