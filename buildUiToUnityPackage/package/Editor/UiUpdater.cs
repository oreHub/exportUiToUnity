using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using TMPro;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.UI;

namespace BuildUiToUnity.Editor
{
    /// <summary>
    /// 段階 2: 反映（再取り込み）。PSD を直して書き出し直したとき、エンジニアが手を入れた Unity の画面を作り直さずに更新する。
    /// 設計は buildUiToUnityPackage/docs/02_importer_plan.md の「段階 2」。
    /// - 部品の照合: ① ID が同じ → ② レイヤー ID が同じ（名前の変更・移動）→ ③ 人が対応付ける
    /// - 値ごとに ① 前に取り込んだ値 ② 今の Unity の値 ③ 新しい PSD の値 を比べる。
    ///   ① = ② ならデザインの変更として更新、② ≠ ③ かつ ① ≠ ② なら人が選ぶ（自動で決めない）
    /// - PSD から消えた部品は、エンジニアの手が入っていなければ削除、入っていれば非表示で残す
    /// Analyze で「これから行う変更の一覧」を作り、確定したら Apply で反映する（Unity の取り消し 1 回で戻せる）。
    /// </summary>
    public class UiUpdater
    {
        public enum Choice { None, Psd, Unity }

        public class Part
        {
            public string prevId, nextId;
            public J prev, next, nextParent;
            public GameObject go;
            public string how;                    // 照合の方法（ID / レイヤー ID / 人）
            public bool Moved => prevId != nextId;
        }

        public class Diff
        {
            public Part part;
            public string key, label;
            public string v1, v2, v3;            // 前に取り込んだ値 / 今の Unity の値 / 新しい PSD の値
            public bool conflict;
            public Choice choice;
            public string Key => $"{part.nextId}|{key}";
        }

        public class Removed
        {
            public string prevId;
            public J prev;
            public GameObject go;
            public List<string> work = new List<string>();   // エンジニアの手が入っている所
            public string matchTo;                            // 人が対応付けた新しい部品の ID（無ければ null）
            public List<string> candidates = new List<string>();
        }

        public readonly UiBuilder builder;
        public readonly J prevLayout;
        public GameObject root;
        public string error;

        public readonly List<Part> parts = new List<Part>();
        public readonly List<Diff> diffs = new List<Diff>();
        public readonly List<J> created = new List<J>();             // 新しく作る部品
        public readonly List<Removed> removed = new List<Removed>(); // PSD から消えた部品（いちばん上のものだけ）
        public readonly List<string> imageUpdates = new List<string>();
        public readonly Dictionary<string, string> manual = new Dictionary<string, string>();   // 前の ID → 人が対応付けた新しい ID
        readonly Dictionary<string, Choice> choices = new Dictionary<string, Choice>();

        Dictionary<string, J> prevById;
        Dictionary<string, string> prevParentId;
        List<(string id, J node, J parent, string parentId)> nextList;

        public UiUpdater(string screenDir, string assetRoot)
        {
            builder = new UiBuilder(screenDir, assetRoot);
            var copy = $"{builder.screenAssets}/{UiBuilder.LayoutCopyName}";
            if (!File.Exists(copy))
            {
                error = $"前に取り込んだときの記録（{copy}）がありません。先に「取り込み」をしてください（0.3.0 より前の取り込みには記録がありません）。";
                return;
            }
            prevLayout = Json.Parse(File.ReadAllText(copy, Encoding.UTF8));
            var scene = SceneManager.GetActiveScene();
            root = scene.GetRootGameObjects().FirstOrDefault(g => g.name == builder.screen);
            if (root == null) error = $"今のシーンに「{builder.screen}」がありません。取り込んだシーンを開いてください。";
        }

        public string PrevVersion => prevLayout["version"].Str;
        public string NextVersion => builder.layout["version"].Str;
        public IEnumerable<Diff> Conflicts => diffs.Where(d => d.conflict);
        public IEnumerable<Diff> Autos => diffs.Where(d => !d.conflict);
        public bool Ready => error == null && Conflicts.All(d => d.choice != Choice.None);

        public void SetChoice(Diff d, Choice c) { d.choice = c; choices[d.Key] = c; }

        // ------------------------------------------------------------------ 比べる（これから行う変更の一覧を作る）
        public void Analyze()
        {
            parts.Clear(); diffs.Clear(); created.Clear(); removed.Clear(); imageUpdates.Clear();
            if (error != null) return;

            prevById = new Dictionary<string, J>();
            prevParentId = new Dictionary<string, string>();
            var prevByLayer = new Dictionary<string, string>();
            void IndexPrev(J n, string id)
            {
                foreach (var c in n["children"].Items)
                {
                    var cid = id == "" ? c["unity"]["name"].Str : $"{id}/{c["unity"]["name"].Str}";
                    prevById[cid] = c;
                    prevParentId[cid] = id;
                    if (c.Has("layer_id")) prevByLayer[LayerKey(c)] = cid;
                    IndexPrev(c, cid);
                }
            }
            IndexPrev(prevLayout["tree"], "");

            nextList = new List<(string, J, J, string)>();
            void IndexNext(J n, string id)
            {
                foreach (var c in builder.OrderedChildren(n))
                {
                    var cid = id == "" ? c["unity"]["name"].Str : $"{id}/{c["unity"]["name"].Str}";
                    nextList.Add((cid, c, n, id));
                    IndexNext(c, cid);
                }
            }
            IndexNext(builder.layout["tree"], "");
            var nextIds = new HashSet<string>(nextList.Select(x => x.id));

            // 部品の照合
            var used = new HashSet<string>();
            foreach (var (id, node, parent, _) in nextList)
            {
                string prevId = null, how = null;
                if (prevById.ContainsKey(id)) { prevId = id; how = "ID"; }
                else if (node.Has("layer_id") && prevByLayer.TryGetValue(LayerKey(node), out var lid) && !nextIds.Contains(lid) && !used.Contains(lid)) { prevId = lid; how = "レイヤー ID"; }
                else
                {
                    var m = manual.FirstOrDefault(kv => kv.Value == id);
                    if (m.Key != null && !used.Contains(m.Key)) { prevId = m.Key; how = "人"; }
                }
                if (prevId == null) { created.Add(node); continue; }
                used.Add(prevId);
                var part = new Part { prevId = prevId, nextId = id, prev = prevById[prevId], next = node, nextParent = parent, how = how, go = Find(prevId) };
                parts.Add(part);
                if (part.go == null)
                {
                    // 前に取り込んだのに Unity に無い（エンジニアが消した）
                    AddDiff(part, "exists", "部品", "（あり）", "（Unity で削除済み）", "（あり）");
                    continue;
                }
                CompareValues(part);
            }

            // PSD から消えた部品（いちばん上のものだけ。中身は一緒に扱う）
            var matchedGos = new HashSet<GameObject>(parts.Where(p => p.go != null).Select(p => p.go));
            var partGos = new HashSet<GameObject>(prevById.Keys.Select(Find).Where(g => g != null));
            var newIds = created.Select(n => nextList.First(x => x.node.v == n.v).id).ToList();
            foreach (var id in prevById.Keys.Where(k => !used.Contains(k)))
            {
                var pid = prevParentId[id];
                if (pid != "" && !used.Contains(pid) && prevById.ContainsKey(pid)) continue;   // 親も消えている
                var r = new Removed { prevId = id, prev = prevById[id], go = Find(id) };
                if (r.go != null) EngineerWork(r.go, matchedGos, partGos, r.work, true);
                if (r.work.Count > 0) r.candidates = RankCandidates(r, newIds);
                removed.Add(r);
            }
            foreach (var r in removed) r.matchTo = manual.TryGetValue(r.prevId, out var t) ? t : null;

            // 中身が変わった画像（ファイル名は同じ）。ファイルを入れ替えると Unity でも変わる
            var prevHash = new Dictionary<string, string>();
            void Hashes(J n, Dictionary<string, string> into)
            {
                var img = UiBuilder.ImageNode(n);
                if (!img.IsNull && img["file"].Str != null) into[img["file"].Str] = img["hash"].Str;
                foreach (var c in n["children"].Items) Hashes(c, into);
            }
            Hashes(prevLayout["tree"], prevHash);
            var nextHash = new Dictionary<string, string>();
            Hashes(builder.layout["tree"], nextHash);
            imageUpdates.AddRange(nextHash.Where(kv => prevHash.TryGetValue(kv.Key, out var h) && h != kv.Value).Select(kv => kv.Key));
        }

        static string LayerKey(J n) => n["layer_id"].v is double d ? d.ToString(CultureInfo.InvariantCulture) : n["layer_id"].Str;

        GameObject Find(string id)
        {
            var t = root.transform.Find(id);
            return t != null ? t.gameObject : null;
        }

        void AddDiff(Part part, string key, string label, string v1, string v2, string v3)
        {
            if (v2 == v3) return;
            var conflict = !(v1 == v2) && key != "move";
            var d = new Diff { part = part, key = key, label = label, v1 = v1, v2 = v2, v3 = v3, conflict = conflict };
            if (conflict && choices.TryGetValue(d.Key, out var c)) d.choice = c;
            diffs.Add(d);
        }

        void CompareValues(Part p)
        {
            var go = p.go;
            var prevParent = prevParentId[p.prevId] == "" ? prevLayout["tree"] : prevById[prevParentId[p.prevId]];
            var prevItem = builder.IsLayoutItem(prevParent, p.prev);
            var nextItem = builder.IsLayoutItem(p.nextParent, p.next);

            if (p.Moved)
            {
                var parentId = p.nextId.Contains("/") ? p.nextId.Substring(0, p.nextId.LastIndexOf('/')) : "（画面の直下）";
                AddDiff(p, "move", "名前・場所", p.prevId, p.prevId, $"{p.nextId}（{p.how}で照合。親 {parentId}）");
            }

            // 位置・大きさ。並びの項目は LayoutGroup が位置を決めるので大きさだけ比べる。
            // 並びの項目から外れた・別の親に移った部品は、前の値と比べられないのでデザインの値にする
            if (nextItem || prevItem)
                AddDiff(p, "size", "大きさ", Size(p.prev), Size(go), Size(p.next));
            if (!nextItem)
            {
                var v3 = Rect(p.next);
                var v1 = prevItem || p.Moved ? Rect(go) : Rect(p.prev);
                AddDiff(p, "rect", "位置・大きさ", v1, Rect(go), v3);
            }

            if (UiBuilder.HasImage(p.next) || UiBuilder.HasImage(p.prev))
                AddDiff(p, "image", "画像", ImageFile(p.prev), builder.FileOf(UiBuilder.ImageComponent(go)?.sprite), ImageFile(p.next));

            if (p.next["role"].Str == "text")
            {
                var tmp = go.GetComponent<TextMeshProUGUI>();
                AddDiff(p, "text", "文字", p.prev["text"]["content"].Str ?? "", tmp != null ? tmp.text : "（文字なし）", p.next["text"]["content"].Str ?? "");
                AddDiff(p, "text_style", "文字の見た目", TextStyle(p.prev), TextStyle(go), TextStyle(p.next));
            }

            if (p.next.Has("layout") || p.prev.Has("layout"))
                AddDiff(p, "layout", "並びの間隔・余白", LayoutValue(p.prev, prevLayout), LayoutValue(go), LayoutValue(p.next, builder.layout));

            if (p.next["role"].Str == "group")
                AddDiff(p, "alpha", "不透明度", F(UiBuilder.Opacity(p.prev)), F(go.TryGetComponent<CanvasGroup>(out var cg) ? cg.alpha : 1f), F(UiBuilder.Opacity(p.next)));
        }

        // ------------------------------------------------------------------ 値を文字にする（比べる・表示する）
        static string F(float v) => (Mathf.Round(v * 100f) / 100f).ToString("0.##", CultureInfo.InvariantCulture);
        static string V(Vector2 v) => $"{F(v.x)}, {F(v.y)}";

        static string Rect(J n)
        {
            var u = n["unity"];
            return RectText(u["anchorMin"].V2, u["anchorMax"].V2, u["pivot"].V2, u["anchoredPosition"].V2, u["sizeDelta"].V2);
        }
        static string Rect(GameObject go)
        {
            var rt = (RectTransform)go.transform;
            return RectText(rt.anchorMin, rt.anchorMax, rt.pivot, rt.anchoredPosition, rt.sizeDelta);
        }
        static string RectText(Vector2 amin, Vector2 amax, Vector2 pivot, Vector2 pos, Vector2 size)
        {
            var s = $"位置 ({V(pos)})・大きさ {F(size.x)}×{F(size.y)}";
            if (amin != new Vector2(0.5f, 0.5f) || amax != amin || pivot != amin) s += $"・アンカー ({V(amin)})-({V(amax)}) ピボット ({V(pivot)})";
            return s;
        }
        static string Size(J n) { var s = n["unity"]["sizeDelta"].V2; return $"{F(s.x)}×{F(s.y)}"; }
        static string Size(GameObject go) { var s = ((RectTransform)go.transform).sizeDelta; return $"{F(s.x)}×{F(s.y)}"; }

        static string ImageFile(J n)
        {
            if (!UiBuilder.HasImage(n)) return "（なし）";
            var img = UiBuilder.ImageNode(n);
            return img.IsNull ? "（なし）" : img["file"].Str;
        }

        static string TextStyle(J n)
        {
            var t = n["text"];
            var align = t["align"].Str == "center" || t["align"].Str == "right" ? t["align"].Str : "left";
            return $"大きさ {F(t["size"].F)}・色 #{ColorUtility.ToHtmlStringRGBA(UiBuilder.TextColor(n))}・揃え {AlignName(align)}";
        }
        static string TextStyle(GameObject go)
        {
            if (!go.TryGetComponent<TextMeshProUGUI>(out var tmp)) return "（文字なし）";
            var align = tmp.horizontalAlignment == HorizontalAlignmentOptions.Center ? "center" : tmp.horizontalAlignment == HorizontalAlignmentOptions.Right ? "right" : "left";
            return $"大きさ {F(tmp.fontSize)}・色 #{ColorUtility.ToHtmlStringRGBA(tmp.color)}・揃え {AlignName(align)}";
        }
        static string AlignName(string a) => a == "center" ? "中央" : a == "right" ? "右" : "左";

        static string LayoutValue(J n, J layout)
        {
            if (!n.Has("layout")) return "（並びなし）";
            var l = layout["layouts"][n["layout"].I];
            var p = l["padding_lrtb"];
            return $"{(l["axis"].Str == "horizontal" ? "横" : "縦")}・間隔 {F(l["spacing"].F)}・余白 左 {p[0].I} 右 {p[1].I} 上 {p[2].I} 下 {p[3].I}";
        }
        static string LayoutValue(GameObject go)
        {
            if (!go.TryGetComponent<HorizontalOrVerticalLayoutGroup>(out var g)) return "（並びなし）";
            var p = g.padding;
            return $"{(g is HorizontalLayoutGroup ? "横" : "縦")}・間隔 {F(g.spacing)}・余白 左 {p.left} 右 {p.right} 上 {p.top} 下 {p.bottom}";
        }

        // ------------------------------------------------------------------ エンジニアの手が入っているか
        static readonly HashSet<Type> DesignTypes = new HashSet<Type>
        {
            typeof(Transform), typeof(RectTransform), typeof(CanvasRenderer), typeof(Image), typeof(TextMeshProUGUI),
            typeof(HorizontalLayoutGroup), typeof(VerticalLayoutGroup), typeof(CanvasGroup), typeof(LayoutElement),
        };

        /// <summary>デザインの持ち分ではないコンポーネントと、足した部品を集める（別の部品として照合済みのものは除く）</summary>
        static void EngineerWork(GameObject go, HashSet<GameObject> matched, HashSet<GameObject> parts, List<string> work, bool top)
        {
            if (!top && matched.Contains(go)) return;
            foreach (var c in go.GetComponents<Component>())
            {
                if (c == null) work.Add($"{go.name}: 見つからないスクリプト");
                else if (!DesignTypes.Contains(c.GetType())) work.Add($"{go.name}: {c.GetType().Name}");
            }
            foreach (Transform t in go.transform)
            {
                if (matched.Contains(t.gameObject)) continue;
                if (!parts.Contains(t.gameObject) && t.name != "Image") work.Add($"{go.name}: 足した部品 {t.name}");
                EngineerWork(t.gameObject, matched, parts, work, false);
            }
        }

        // 人が対応付けるときの候補。同じ親・同じ種類・位置や大きさが近いものを先にする
        List<string> RankCandidates(Removed r, List<string> newIds)
        {
            var prc = r.prev["rect"].Rect;
            var parent = prevParentId[r.prevId];
            return newIds.Select(id =>
            {
                var n = nextList.First(x => x.id == id);
                var rc = n.node["rect"].Rect;
                var score = (n.parentId == parent ? 100000f : 0f) + (n.node["role"].Str == r.prev["role"].Str ? 50000f : 0f)
                            - (rc.center - prc.center).magnitude - Mathf.Abs(rc.width - prc.width) - Mathf.Abs(rc.height - prc.height);
                return (id, score);
            }).OrderByDescending(x => x.score).Select(x => x.id).ToList();
        }

        // ------------------------------------------------------------------ 反映する
        public string Apply()
        {
            if (!Ready) return "選んでいない項目があります。";
            builder.ImportImages();   // 画像の入れ替え（アセットなので取り消しの対象外）

            Undo.IncrementCurrentGroup();
            Undo.SetCurrentGroupName($"{UiBuilder.Title}: {builder.screen} を {NextVersion} に更新");
            var group = Undo.GetCurrentGroup();
            builder.useUndo = true;

            var byNext = parts.ToDictionary(p => p.nextId);
            var goOf = new Dictionary<string, GameObject> { [""] = root };
            var kept = new List<Diff>();
            var log = new List<string>();
            var skipped = new HashSet<string>();
            builder.created[builder.layout["tree"].v] = root;

            foreach (var (id, node, _, parentId) in nextList)
            {
                if (skipped.Contains(parentId) || !goOf.TryGetValue(parentId, out var parentGo) || parentGo == null) { skipped.Add(id); continue; }
                byNext.TryGetValue(id, out var part);
                var exists = part != null ? diffs.FirstOrDefault(d => d.part == part && d.key == "exists") : null;

                GameObject go;
                if (part == null || exists != null)
                {
                    if (exists != null && exists.choice == Choice.Unity) { kept.Add(exists); skipped.Add(id); goOf[id] = null; continue; }
                    go = builder.BuildOne(node, parentGo.transform);
                    log.Add($"追加: {id}");
                }
                else
                {
                    go = part.go;
                    if (part.Moved)
                    {
                        builder.SetName(go, node["unity"]["name"].Str);
                        if (go.transform.parent != parentGo.transform)
                        {
                            Undo.SetTransformParent(go.transform, parentGo.transform, UiBuilder.Title);
                            builder.SetRect(go, node, true);   // 親を移すと見た目の位置を保とうとして値が変わるので、PSD の値を入れ直す
                        }
                        log.Add($"名前・場所: {part.prevId} → {id}（{part.how}で照合）");
                    }
                    foreach (var d in diffs.Where(d => d.part == part && d.key != "move"))
                    {
                        if (d.conflict && d.choice == Choice.Unity) { kept.Add(d); continue; }
                        ApplyValue(go, node, d.key);
                        log.Add($"{(d.conflict ? "PSD の値にした" : "更新")}: {id} の{d.label}");
                    }
                }
                builder.created[node.v] = go;
                goOf[id] = go;
            }

            // 並び順と、並びの項目でない子の扱い
            Reorder(builder.layout["tree"], goOf, "");
            builder.ApplyLayoutIgnore(builder.layout["tree"], root);
            foreach (var (id, node, _, _) in nextList)
            {
                if (!goOf.TryGetValue(id, out var go) || go == null) continue;
                Reorder(node, goOf, id);
                builder.ApplyLayoutIgnore(node, go);
            }

            // PSD から消えた部品
            foreach (var r in removed)
            {
                if (r.go == null || r.matchTo != null) continue;
                if (r.work.Count == 0)
                {
                    if (PrefabUtility.IsPartOfPrefabInstance(r.go) && !PrefabUtility.IsOutermostPrefabInstanceRoot(r.go)) builder.SetActive(r.go, false);
                    else Undo.DestroyObjectImmediate(r.go);
                    log.Add($"削除: {r.prevId}");
                }
                else
                {
                    builder.SetActive(r.go, false);
                    log.Add($"非表示で残した（エンジニアの作業あり）: {r.prevId}");
                }
            }

            Undo.CollapseUndoOperations(group);
            builder.WriteRecord(root.scene.path);
            WriteKept(kept);
            EditorSceneManager.MarkSceneDirty(root.scene);

            var sb = new StringBuilder();
            sb.AppendLine($"{builder.screen} を版 {PrevVersion} から {NextVersion} に更新しました（Ctrl+Z で 1 回で戻せます。シーンの保存はまだです）。");
            sb.AppendLine($"更新 {Autos.Count(d => d.key != "move")} / 選んだ {Conflicts.Count()}（Unity の値を残した {kept.Count}）/ 追加 {created.Count} / 名前・場所 {parts.Count(p => p.Moved)} / " +
                          $"削除 {removed.Count(r => r.go != null && r.matchTo == null && r.work.Count == 0)} / 非表示 {removed.Count(r => r.go != null && r.matchTo == null && r.work.Count > 0)}");
            if (imageUpdates.Count > 0) sb.AppendLine($"中身が変わった画像 {imageUpdates.Count} 枚");
            if (kept.Count > 0) sb.AppendLine($"Unity の値を残したものは「PSD に戻す候補」として {builder.screenAssets}/{KeptName} に記録しました。");
            foreach (var l in log.Concat(builder.notes)) Debug.Log($"[{UiBuilder.Title}] {l}");
            return sb.ToString();
        }

        void ApplyValue(GameObject go, J node, string key)
        {
            switch (key)
            {
                case "rect": builder.SetRect(go, node, true); break;
                case "size": builder.SetRect(go, node, false); break;
                case "image": builder.SetImageOf(go, node); break;
                case "text": builder.SetTextContent(go, node); break;
                case "text_style": builder.SetTextStyle(go, node); break;
                case "layout":
                    if (node.Has("layout")) builder.SetLayout(go, node);
                    else if (go.TryGetComponent<HorizontalOrVerticalLayoutGroup>(out var g)) Undo.DestroyObjectImmediate(g);
                    break;
                case "alpha": builder.SetGroupAlpha(go, node); break;
            }
        }

        // 部品の子の並び順を新しい PSD に合わせる。エンジニアが足した子の場所は変えない。Prefab の中の並びは変えられないので触らない
        void Reorder(J node, Dictionary<string, GameObject> goOf, string id)
        {
            var kids = builder.OrderedChildren(node)
                .Select(c => goOf.TryGetValue(id == "" ? c["unity"]["name"].Str : $"{id}/{c["unity"]["name"].Str}", out var g) ? g : null)
                .Where(g => g != null).ToList();
            if (kids.Count < 2) return;
            if (kids.Any(g => PrefabUtility.IsPartOfPrefabInstance(g) && !PrefabUtility.IsOutermostPrefabInstanceRoot(g))) return;
            var slots = kids.Select(g => g.transform.GetSiblingIndex()).OrderBy(i => i).ToList();
            if (kids.Select(g => g.transform.GetSiblingIndex()).SequenceEqual(slots)) return;
            Undo.RegisterChildrenOrderUndo(kids[0].transform.parent, UiBuilder.Title);
            for (var k = 0; k < kids.Count; k++) kids[k].transform.SetSiblingIndex(slots[k]);
        }

        // 「Unity の値を残す」を選んだもの = PSD に戻す候補（後で作る Unity → PSD の機能で使う）
        public const string KeptName = "BuildUiToUnity_keep.json";
        void WriteKept(List<Diff> kept)
        {
            var path = $"{builder.screenAssets}/{KeptName}";
            var sb = new StringBuilder();
            sb.Append("{\n");
            sb.Append($"  \"screen\": \"{UiBuilder.Esc(builder.screen)}\",\n  \"version\": \"{UiBuilder.Esc(NextVersion)}\",\n");
            sb.Append($"  \"decided_at\": \"{DateTime.Now:yyyy-MM-ddTHH:mm:ss}\",\n  \"items\": [");
            sb.Append(string.Join(",", kept.Select(d =>
                $"\n    {{ \"id\": \"{UiBuilder.Esc(d.part.nextId)}\", \"layer_id\": \"{UiBuilder.Esc(LayerKey(d.part.next))}\", \"value\": \"{d.key}\", " +
                $"\"unity\": \"{UiBuilder.Esc(d.v2)}\", \"psd\": \"{UiBuilder.Esc(d.v3)}\" }}")));
            sb.Append(kept.Count > 0 ? "\n  ]\n}\n" : "]\n}\n");
            File.WriteAllText(path, sb.ToString(), new UTF8Encoding(false));
            AssetDatabase.ImportAsset(path);
        }
    }
}
