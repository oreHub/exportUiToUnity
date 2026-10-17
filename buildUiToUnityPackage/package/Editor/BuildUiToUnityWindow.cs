using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using UnityEditor;
using UnityEngine;

namespace BuildUiToUnity.Editor
{
    /// <summary>
    /// 書き出しフォルダ（UIExport）の中の画面を一覧し、版と問題の件数を見るウインドウ。
    /// 取り込み（GameObject の組み立て）はこれから作る（buildUiToUnityPackage/docs/02_importer_plan.md）。
    /// </summary>
    public class BuildUiToUnityWindow : EditorWindow
    {
        [Serializable] class Issue { public string level; public string code; public string message; }

        // layout.json のうち、一覧に使う項目だけ（JsonUtility は知らない項目を読み飛ばす）
        [Serializable]
        class LayoutHeader
        {
            public string screen;
            public string version;
            public string base_version;
            public string psd_file;
            public string exported_at;
            public int[] canvas;
            public List<Issue> issues;
        }

        class ScreenInfo
        {
            public string id;
            public string dir;
            public LayoutHeader header;
            public string error;
            public readonly int[] counts = new int[4];   // エラー / 注意 / 提案 / 情報
        }

        static readonly string[] Levels = { "error", "warn", "suggest", "info" };

        string exportRoot;
        Vector2 scroll;
        readonly List<ScreenInfo> screens = new List<ScreenInfo>();

        // EditorPrefs は PC 全体で共有されるので、プロジェクトごとに分ける
        static string PrefKey => "BuildUiToUnity.ExportRoot:" + Application.dataPath;
        static string DefaultRoot => Path.GetFullPath(Path.Combine(Application.dataPath, "..", "UIExport"));

        [MenuItem("Tools/Build UI To Unity")]
        static void Open() => GetWindow<BuildUiToUnityWindow>("Build UI To Unity");

        void OnEnable()
        {
            exportRoot = EditorPrefs.GetString(PrefKey, DefaultRoot);
            Scan();
        }

        void Scan()
        {
            screens.Clear();
            if (!Directory.Exists(exportRoot)) return;
            foreach (var dir in Directory.GetDirectories(exportRoot))
            {
                var path = Path.Combine(dir, "layout.json");
                if (!File.Exists(path)) continue;
                var s = new ScreenInfo { id = Path.GetFileName(dir), dir = dir };
                try
                {
                    s.header = JsonUtility.FromJson<LayoutHeader>(File.ReadAllText(path, Encoding.UTF8));
                    if (s.header.issues != null)
                        foreach (var i in s.header.issues)
                        {
                            var k = Array.IndexOf(Levels, i.level);
                            if (k >= 0) s.counts[k]++;
                        }
                }
                catch (Exception e)
                {
                    s.error = "layout.json を読めません: " + e.Message;
                }
                screens.Add(s);
            }
            screens.Sort((a, b) => string.CompareOrdinal(a.id, b.id));
        }

        void OnGUI()
        {
            EditorGUILayout.LabelField("書き出しフォルダ（UIExport）", EditorStyles.boldLabel);
            using (new EditorGUILayout.HorizontalScope())
            {
                EditorGUILayout.SelectableLabel(exportRoot, EditorStyles.textField, GUILayout.Height(EditorGUIUtility.singleLineHeight));
                if (GUILayout.Button("選ぶ…", GUILayout.Width(60)))
                {
                    var p = EditorUtility.OpenFolderPanel("UIExport フォルダを選ぶ", exportRoot, "");
                    if (!string.IsNullOrEmpty(p))
                    {
                        exportRoot = p;
                        EditorPrefs.SetString(PrefKey, p);
                        Scan();
                    }
                }
                if (GUILayout.Button("再読み込み", GUILayout.Width(80))) Scan();
            }

            if (!Directory.Exists(exportRoot))
            {
                EditorGUILayout.HelpBox("フォルダがありません。プラグインで書き出すか、「選ぶ…」でフォルダを指定してください。", MessageType.Warning);
                return;
            }
            if (screens.Count == 0)
            {
                EditorGUILayout.HelpBox("layout.json のある画面が見つかりません（UIExport/<画面ID>/layout.json）。", MessageType.Info);
                return;
            }

            scroll = EditorGUILayout.BeginScrollView(scroll);
            foreach (var s in screens)
            {
                using (new EditorGUILayout.VerticalScope(EditorStyles.helpBox))
                {
                    EditorGUILayout.LabelField(s.id, EditorStyles.boldLabel);
                    if (s.error != null)
                    {
                        EditorGUILayout.HelpBox(s.error, MessageType.Error);
                        continue;
                    }
                    var h = s.header;
                    var baseVer = string.IsNullOrEmpty(h.base_version) ? "なし（初回）" : h.base_version;
                    EditorGUILayout.LabelField("版", $"{h.version}（元にした版 {baseVer}）");
                    EditorGUILayout.LabelField("PSD", h.psd_file);
                    EditorGUILayout.LabelField("書き出し", h.exported_at);
                    if (h.canvas != null && h.canvas.Length == 2)
                        EditorGUILayout.LabelField("画面", $"{h.canvas[0]} × {h.canvas[1]}");
                    EditorGUILayout.LabelField("問題", $"エラー {s.counts[0]} / 注意 {s.counts[1]} / 提案 {s.counts[2]} / 情報 {s.counts[3]}");
                    if (s.counts[0] > 0)
                        EditorGUILayout.HelpBox("エラーがあります。取り込むと構造が崩れる可能性があります（取り込むときに確認を出す予定）。", MessageType.Warning);

                    using (new EditorGUILayout.HorizontalScope())
                    {
                        using (new EditorGUI.DisabledScope(true))
                            GUILayout.Button("取り込み（未実装）");
                        if (GUILayout.Button("report.html を開く"))
                            Application.OpenURL("file:///" + Path.Combine(s.dir, "report.html").Replace("\\", "/"));
                    }
                }
            }
            EditorGUILayout.EndScrollView();
        }
    }
}
