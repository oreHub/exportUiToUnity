using System;
using System.Linq;
using UnityEditor;
using UnityEngine;

namespace BuildUiToUnity.Editor
{
    /// <summary>
    /// 反映（段階 2）の確認画面。「これから行う変更の一覧」を出し、エンジニアの変更と PSD が違う所はすべて選んでもらってから確定する。
    /// </summary>
    public class UiUpdateWindow : EditorWindow
    {
        UiUpdater updater;
        Vector2 scroll;
        bool showAutos = true, showCreated = true, showRemoved = true, showImages;
        GUIStyle wrap;

        public static void Open(string screenDir, string assetRoot)
        {
            if (!UiBuilder.CheckTmp()) return;
            var u = new UiUpdater(screenDir, assetRoot);
            if (u.error != null) { EditorUtility.DisplayDialog(UiBuilder.Title, u.error, "OK"); return; }
            if (!UiBuilder.ConfirmErrors(u.builder.layout, u.builder.screen)) return;
            u.Analyze();
            var w = GetWindow<UiUpdateWindow>(true, $"反映: {u.builder.screen}");
            w.updater = u;
            w.minSize = new Vector2(640, 420);
            w.Show();
        }

        void OnGUI()
        {
            if (updater == null) { EditorGUILayout.HelpBox("閉じて、もう一度「反映」を押してください。", MessageType.Info); return; }
            if (updater.root == null) { EditorGUILayout.HelpBox("画面が見つかりません（シーンを切り替えた？）。閉じて、もう一度「反映」を押してください。", MessageType.Warning); return; }
            wrap ??= new GUIStyle(EditorStyles.label) { wordWrap = true, richText = true };
            var u = updater;

            EditorGUILayout.LabelField($"{u.builder.screen}: 版 {u.PrevVersion} → {u.NextVersion}", EditorStyles.boldLabel);
            EditorGUILayout.LabelField("まだ何も変えていません。内容を確かめ、選ぶ所をすべて選んでから「確定」を押してください。", wrap);

            scroll = EditorGUILayout.BeginScrollView(scroll);

            // 選んでもらう所（エンジニアの変更と PSD が違う）
            var conflicts = u.Conflicts.ToList();
            Header($"選んでください（エンジニアが変えた所と、新しい PSD が違う）: {conflicts.Count} 件", conflicts.Count > 0);
            if (conflicts.Count > 0)
            {
                using (new EditorGUILayout.HorizontalScope())
                {
                    if (GUILayout.Button("すべて PSD の値にする")) foreach (var d in conflicts) u.SetChoice(d, UiUpdater.Choice.Psd);
                    if (GUILayout.Button("すべて Unity の値を残す")) foreach (var d in conflicts) u.SetChoice(d, UiUpdater.Choice.Unity);
                }
                foreach (var d in conflicts)
                {
                    using (new EditorGUILayout.VerticalScope(EditorStyles.helpBox))
                    {
                        EditorGUILayout.LabelField($"<b>{d.part.nextId}</b> の{d.label}", wrap);
                        if (d.key != "exists") EditorGUILayout.LabelField($"前に取り込んだ値: {d.v1}", wrap);
                        EditorGUILayout.LabelField($"今の Unity: {d.v2}", wrap);
                        EditorGUILayout.LabelField($"新しい PSD: {d.v3}", wrap);
                        using (new EditorGUILayout.HorizontalScope())
                        {
                            var psd = d.key == "exists" ? "PSD どおり作り直す" : "PSD の値にする";
                            var unity = d.key == "exists" ? "Unity のまま（作らない）" : "Unity の値を残す（PSD に戻す候補）";
                            if (GUILayout.Toggle(d.choice == UiUpdater.Choice.Psd, psd, "Button")) u.SetChoice(d, UiUpdater.Choice.Psd);
                            if (GUILayout.Toggle(d.choice == UiUpdater.Choice.Unity, unity, "Button")) u.SetChoice(d, UiUpdater.Choice.Unity);
                        }
                    }
                }
            }

            // PSD から消えた部品
            var removed = u.removed.Where(r => r.go != null).ToList();
            var manualParts = u.parts.Where(p => p.how == "人").ToList();
            showRemoved = Foldout(showRemoved, $"PSD から消えた部品: 削除 {removed.Count(r => r.work.Count == 0)} / 非表示で残す {removed.Count(r => r.work.Count > 0)}");
            if (showRemoved)
            {
                foreach (var r in removed)
                {
                    using (new EditorGUILayout.VerticalScope(EditorStyles.helpBox))
                    {
                        if (r.work.Count == 0) { EditorGUILayout.LabelField($"削除: {r.prevId}", wrap); continue; }
                        EditorGUILayout.LabelField($"<b>{r.prevId}</b>: エンジニアの作業があるので、削除せず非表示で残します", wrap);
                        EditorGUILayout.LabelField("作業: " + string.Join("、", r.work.Take(6)) + (r.work.Count > 6 ? $" ほか {r.work.Count - 6} 件" : ""), wrap);
                        if (r.candidates.Count > 0)
                        {
                            // 作り直して名前も変わった場合に、新しい部品と対応付ける
                            var options = new[] { "新しく増えた部品のどれとも違う（非表示で残す）" }.Concat(r.candidates.Select(c => $"{c} と同じ部品")).ToArray();
                            var pick = EditorGUILayout.Popup("同じ部品は？", 0, options);
                            if (pick > 0) { u.manual[r.prevId] = r.candidates[pick - 1]; Reanalyze(); GUIUtility.ExitGUI(); }
                        }
                    }
                }
                foreach (var p in manualParts)
                {
                    using (new EditorGUILayout.HorizontalScope(EditorStyles.helpBox))
                    {
                        EditorGUILayout.LabelField($"対応付けた: {p.prevId} → {p.nextId}", wrap);
                        if (GUILayout.Button("やめる", GUILayout.Width(60))) { u.manual.Remove(p.prevId); Reanalyze(); GUIUtility.ExitGUI(); }
                    }
                }
            }

            // 自動で行う変更（Unity で誰も触っていない所 = デザインの変更）
            var autos = u.Autos.ToList();
            showAutos = Foldout(showAutos, $"デザインの変更として更新する（Unity で誰も触っていない所）: {autos.Count} 件");
            if (showAutos)
                foreach (var d in autos)
                    EditorGUILayout.LabelField($"{d.part.nextId} の{d.label}: {d.v2} → {d.v3}", wrap);

            showCreated = Foldout(showCreated, $"新しく作る部品: {u.created.Count} 個");
            if (showCreated)
                foreach (var n in u.created)
                    EditorGUILayout.LabelField($"{n["path"].Str}（{n["role"].Str}）", wrap);

            showImages = Foldout(showImages, $"中身が変わった画像: {u.imageUpdates.Count} 枚");
            if (showImages)
                foreach (var f in u.imageUpdates) EditorGUILayout.LabelField(f, wrap);

            EditorGUILayout.EndScrollView();

            EditorGUILayout.Space();
            using (new EditorGUILayout.HorizontalScope())
            {
                var left = conflicts.Count(d => d.choice == UiUpdater.Choice.None);
                GUILayout.Label(left > 0 ? $"あと {left} 件 選んでください" : "確定すると反映します（Ctrl+Z で 1 回で戻せます）");
                using (new EditorGUI.DisabledScope(!u.Ready))
                    if (GUILayout.Button("確定", GUILayout.Width(120), GUILayout.Height(28))) Confirm();
                if (GUILayout.Button("やめる", GUILayout.Width(80), GUILayout.Height(28))) Close();
            }
        }

        void Reanalyze() => updater.Analyze();

        void Confirm()
        {
            string msg;
            try
            {
                msg = updater.Apply();
            }
            catch (Exception e)
            {
                Debug.LogException(e);
                msg = "反映中にエラーが出ました。Ctrl+Z で戻し、コンソールの内容を送ってください。\n\n" + e.Message;
            }
            Close();
            EditorUtility.DisplayDialog(UiBuilder.Title, msg, "OK");
        }

        static void Header(string text, bool attention)
        {
            EditorGUILayout.Space();
            var style = new GUIStyle(EditorStyles.boldLabel) { wordWrap = true };
            if (attention) style.normal.textColor = new Color(1f, 0.73f, 0.2f);
            EditorGUILayout.LabelField(text, style);
        }

        static bool Foldout(bool open, string text)
        {
            EditorGUILayout.Space();
            return EditorGUILayout.Foldout(open, text, true, EditorStyles.foldoutHeader);
        }
    }
}
