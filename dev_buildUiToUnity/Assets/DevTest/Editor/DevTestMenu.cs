using System.Collections.Generic;
using System.Linq;
using UnityEditor;
using UnityEditor.Events;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.UI;

/// <summary>
/// 再取り込み（段階 2）の確認用。開いているシーンの Home/Footer に「エンジニアの作業」のつもりのダミーを付け、
/// 反映のあとに消えずに残っているかを確かめる。ツール本体（buildUiToUnityPackage）とは関係ない。
/// </summary>
static class DevTestMenu
{
    const string FooterPath = "Home/Footer";

    [MenuItem("Dev/フッターにダミーのスクリプトを付ける")]
    static void Setup()
    {
        var footer = GameObject.Find(FooterPath);
        if (footer == null) { EditorUtility.DisplayDialog("Dev", $"{FooterPath} が見つかりません。Home を取り込んだシーンを開いてください。", "OK"); return; }

        var menu = footer.TryGetComponent<DevFooterMenu>(out var m) ? m : Undo.AddComponent<DevFooterMenu>(footer);
        Undo.RecordObject(menu, "Dev: Footer");
        menu.entries.Clear();
        foreach (Transform t in footer.transform)
        {
            var go = t.gameObject;
            menu.entries.Add(new DevFooterMenu.Entry { button = go, destination = go.name.Replace("Btn_Footer_", "") + "Scene" });

            var b = go.TryGetComponent<DevFooterButton>(out var db) ? db : Undo.AddComponent<DevFooterButton>(go);
            Undo.RecordObject(b, "Dev: Button");
            b.label = go.name;
            b.badgeCount = 0;

            var button = go.TryGetComponent<Button>(out var bt) ? bt : Undo.AddComponent<Button>(go);
            Undo.RecordObject(button, "Dev: Button");
            button.targetGraphic = go.GetComponentsInChildren<Image>(true).FirstOrDefault();
            for (var i = button.onClick.GetPersistentEventCount() - 1; i >= 0; i--) UnityEventTools.RemovePersistentListener(button.onClick, i);
            UnityEventTools.AddPersistentListener(button.onClick, b.OnClick);
            PrefabUtility.RecordPrefabInstancePropertyModifications(button);
            PrefabUtility.RecordPrefabInstancePropertyModifications(b);
        }
        PrefabUtility.RecordPrefabInstancePropertyModifications(menu);
        EditorSceneManager.MarkSceneDirty(footer.scene);
        Selection.activeGameObject = footer;
        EditorUtility.DisplayDialog("Dev",
            $"Footer に DevFooterMenu（ボタン {menu.entries.Count} 個）を付け、各ボタンに DevFooterButton と Button を付けました。\nシーンを保存してください（Ctrl+S）。", "OK");
    }

    [MenuItem("Dev/ダミーのスクリプトを確かめる")]
    static void Check()
    {
        var lines = new List<string>();
        var ok = true;
        void Ng(string s) { ok = false; lines.Add("NG  " + s); }

        var footer = GameObject.Find(FooterPath);
        if (footer == null) Ng($"{FooterPath} が見つからない");
        else if (!footer.TryGetComponent<DevFooterMenu>(out var menu)) Ng("Footer の DevFooterMenu が消えている");
        else
        {
            lines.Add($"OK  Footer の DevFooterMenu（登録 {menu.entries.Count} 個）");
            foreach (var e in menu.entries)
            {
                if (e.button == null) { Ng($"リストのボタンが外れている（遷移先 {e.destination}）"); continue; }
                if (e.button.transform.parent != footer.transform) Ng($"{e.button.name} が Footer の外にある");
                var hasScript = e.button.TryGetComponent<DevFooterButton>(out var b);
                var hasButton = e.button.TryGetComponent<Button>(out var bt);
                var listeners = hasButton ? bt.onClick.GetPersistentEventCount() : 0;
                var target = hasButton && listeners > 0 ? bt.onClick.GetPersistentTarget(0) : null;
                if (!hasScript) Ng($"{e.button.name}: DevFooterButton が消えている");
                else if (!hasButton) Ng($"{e.button.name}: Button が消えている");
                else if (listeners != 1 || target != b) Ng($"{e.button.name}: Button の押したときの設定が変わっている（{listeners} 件）");
                else lines.Add($"OK  {e.button.name} → {e.destination}（DevFooterButton・Button・押したときの設定）");
            }
            foreach (Transform t in footer.transform)
                if (!menu.entries.Any(e => e.button == t.gameObject)) lines.Add($"情報  リストに無いボタン: {t.name}（新しく増えた部品）");
        }
        var msg = (ok ? "すべて残っています。" : "消えた・変わったものがあります。") + "\n\n" + string.Join("\n", lines);
        Debug.Log("[Dev] " + msg);
        EditorUtility.DisplayDialog("Dev", msg, "OK");
    }
}
