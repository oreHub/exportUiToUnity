using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using TMPro;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.SceneManagement;
using UnityEngine.UI;
using Object = UnityEngine.Object;

namespace BuildUiToUnity.Editor
{
    /// <summary>取り込んだ画面を置く場所</summary>
    public enum SceneTarget
    {
        Current,    // 今開いているシーンに追加する
        New,        // 保存先を選んで新しいシーンを作る
    }

    /// <summary>
    /// layout.json（形は docs/04_layout_format.md）から、シーンの Canvas の下に画面を組み立てる（段階 1: 新規の取り込み）。
    /// 1. 画像を Assets/UI/&lt;画面ID&gt;/Images/ にコピーして Sprite にする
    /// 2. tree をたどって GameObject を作る（Image / TextMeshProUGUI / LayoutGroup）
    /// 3. _Prefab の部品を Prefab にする。同じ型は 1 つの Prefab にし、ほかのインスタンスは画像・文字・位置などを差し替える
    /// 部品の値を入れる処理（Set〜）は、段階 2 の反映（UiUpdater）でも使う。
    /// </summary>
    public class UiBuilder
    {
        public const string Title = "Build UI To Unity";
        public const string LayoutCopyName = "BuildUiToUnity_layout.json";   // 取り込んだときの layout.json の写し（反映で「前に取り込んだ値」に使う）
        public const string RecordName = "BuildUiToUnity_record.json";

        internal readonly string screenDir;     // UIExport/<画面ID>（Assets の外）
        internal readonly string assetRoot;     // 例 Assets/UI
        internal readonly J layout;
        internal readonly string screen;
        internal readonly string screenAssets;  // 例 Assets/UI/Home
        internal readonly Dictionary<string, Sprite> sprites = new Dictionary<string, Sprite>();
        internal readonly Dictionary<object, GameObject> created = new Dictionary<object, GameObject>();   // 部品（JSON の値）→ GameObject
        internal readonly List<string> notes = new List<string>();
        internal bool useUndo;                   // 反映では Unity の取り消しで戻せるようにする
        internal int objectCount;

        internal UiBuilder(string screenDir, string assetRoot)
        {
            this.screenDir = screenDir;
            this.assetRoot = assetRoot.TrimEnd('/');
            layout = Json.Parse(File.ReadAllText(Path.Combine(screenDir, "layout.json"), Encoding.UTF8));
            screen = layout["screen"].Str ?? Path.GetFileName(screenDir);
            screenAssets = $"{this.assetRoot}/{screen}";
        }

        public static void Import(string screenDir, string assetRoot, SceneTarget target)
        {
            try
            {
                new UiBuilder(screenDir, assetRoot).Run(target);
            }
            catch (Exception e)
            {
                Debug.LogException(e);
                EditorUtility.DisplayDialog(Title, "取り込み中にエラーが出ました。コンソールの内容を送ってください。\n\n" + e.Message, "OK");
            }
            finally
            {
                EditorUtility.ClearProgressBar();
            }
        }

        void Run(SceneTarget target)
        {
            var version = layout["version"].Str;
            if (!ConfirmErrors(layout, screen) || !CheckTmp()) return;

            // 置き先のシーン
            Scene scene;
            string newScenePath = null;
            if (target == SceneTarget.New)
            {
                newScenePath = EditorUtility.SaveFilePanelInProject("新しいシーンの保存先", screen, "unity",
                    $"{screen} を置く新しいシーンの保存先を選んでください。");
                if (string.IsNullOrEmpty(newScenePath)) return;
                if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return;
                scene = EditorSceneManager.NewScene(NewSceneSetup.DefaultGameObjects, NewSceneMode.Single);
            }
            else
            {
                scene = SceneManager.GetActiveScene();
                var existing = scene.GetRootGameObjects().FirstOrDefault(g => g.name == screen);
                if (existing != null)
                {
                    var choice = EditorUtility.DisplayDialogComplex(Title,
                        $"このシーンには、すでに「{screen}」があります。\n（エンジニアの作業を残したまま更新するときは「反映」を使います）", "置き換える", "やめる", "並べて追加");
                    if (choice == 1) return;
                    if (choice == 0) Undo.DestroyObjectImmediate(existing);
                }
            }

            EditorUtility.DisplayProgressBar(Title, "画像を取り込み中…", 0.1f);
            ImportImages();

            EditorUtility.DisplayProgressBar(Title, "画面を組み立て中…", 0.5f);
            var root = BuildRoot();
            if (target == SceneTarget.Current) Undo.RegisterCreatedObjectUndo(root, $"{Title}: {screen}");

            EditorUtility.DisplayProgressBar(Title, "Prefab を作成中…", 0.7f);
            var prefabCount = BuildPrefabs();

            EnsureEventSystem();
            WriteRecord(newScenePath ?? scene.path);

            if (newScenePath != null) EditorSceneManager.SaveScene(scene, newScenePath);
            else EditorSceneManager.MarkSceneDirty(scene);
            Selection.activeGameObject = root;
            EditorGUIUtility.PingObject(root);

            var msg = $"{screen}（版 {version}）を取り込みました。\n部品 {objectCount} 個 / 画像 {sprites.Count} 枚 / Prefab {prefabCount} 個\n" +
                      (newScenePath != null ? $"シーン: {newScenePath}" : "今のシーンに追加しました（保存はまだです）");
            if (notes.Count > 0) msg += "\n\n" + string.Join("\n", notes.Take(10)) + (notes.Count > 10 ? $"\nほか {notes.Count - 10} 件（コンソール）" : "");
            foreach (var n in notes) Debug.Log($"[{Title}] " + n);
            EditorUtility.DisplayDialog(Title, msg, "OK");
        }

        // エラーのある版は、取り込む前に確かめる（書き出しは止めない決まりなので、最終決定の取り込みで止める）
        internal static bool ConfirmErrors(J layout, string screen)
        {
            var errors = layout["issues"].Items.Count(i => i["level"].Str == "error");
            return errors == 0 || EditorUtility.DisplayDialog(Title,
                $"{screen} の版 {layout["version"].Str} には、エラーが {errors} 件あります。\n取り込むと構造が崩れる可能性があります。続けますか？", "続ける", "やめる");
        }

        // 文字に TextMeshPro の既定のフォントを使う
        internal static bool CheckTmp()
        {
            if (Resources.Load<TMP_Settings>("TMP Settings") != null) return true;
            EditorUtility.DisplayDialog(Title,
                "TextMeshPro の基本データが入っていません。\nメニューの Window > TextMeshPro > Import TMP Essential Resources を実行してから、もう一度行ってください。", "OK");
            return false;
        }

        // ------------------------------------------------------------------ 画像
        internal void ImportImages()
        {
            var files = new HashSet<string>();
            void Collect(J n)
            {
                if (!n["image"].IsNull) files.Add(n["image"]["file"].Str);
                if (!n["base_image"]["image"].IsNull) files.Add(n["base_image"]["image"]["file"].Str);
                foreach (var c in n["children"].Items) Collect(c);
            }
            Collect(layout["tree"]);
            files.Remove(null);

            var dstDir = $"{screenAssets}/Images";
            Directory.CreateDirectory(dstDir);
            foreach (var f in files)
            {
                var src = Path.Combine(screenDir, f);
                if (!File.Exists(src)) { notes.Add($"画像がありません: {f}"); continue; }
                File.Copy(src, $"{dstDir}/{Path.GetFileName(f)}", true);
            }
            AssetDatabase.Refresh();

            foreach (var f in files)
            {
                var path = $"{dstDir}/{Path.GetFileName(f)}";
                if (!(AssetImporter.GetAtPath(path) is TextureImporter ti)) continue;
                ti.textureType = TextureImporterType.Sprite;
                ti.spriteImportMode = SpriteImportMode.Single;
                ti.mipmapEnabled = false;
                ti.alphaIsTransparency = true;
                ti.maxTextureSize = 4096;
                ti.textureCompression = TextureImporterCompression.Uncompressed;   // デザインの確認用に、圧縮で色を変えない
                ti.SaveAndReimport();
                var sp = AssetDatabase.LoadAssetAtPath<Sprite>(path);
                if (sp != null) sprites[f] = sp;
                else notes.Add($"Sprite にできませんでした: {f}");
            }
        }

        /// <summary>Sprite から layout.json の書き方（images/…png）に戻す。取り込んだ画像でなければ「（ほかの画像）」</summary>
        internal string FileOf(Sprite sp)
        {
            if (sp == null) return "（なし）";
            var path = AssetDatabase.GetAssetPath(sp);
            return path.StartsWith($"{screenAssets}/Images/") ? "images/" + Path.GetFileName(path) : $"（ほかの画像 {Path.GetFileName(path)}）";
        }

        // ------------------------------------------------------------------ 組み立て
        GameObject BuildRoot()
        {
            var tree = layout["tree"];
            var canvasSize = layout["canvas"].V2;
            var root = new GameObject(screen, typeof(RectTransform), typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
            root.layer = LayerMask.NameToLayer("UI");
            root.GetComponent<Canvas>().renderMode = RenderMode.ScreenSpaceOverlay;
            var scaler = root.GetComponent<CanvasScaler>();
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = canvasSize;
            scaler.matchWidthOrHeight = 0.5f;
            created[tree.v] = root;
            foreach (var c in OrderedChildren(tree)) Build(c, root.transform);
            ApplyLayoutIgnore(tree, root);
            return root;
        }

        GameObject Build(J n, Transform parent)
        {
            var go = BuildOne(n, parent);
            foreach (var c in OrderedChildren(n)) Build(c, go.transform);
            ApplyLayoutIgnore(n, go);
            return go;
        }

        /// <summary>部品を 1 つだけ作る（子は作らない）</summary>
        internal GameObject BuildOne(J n, Transform parent)
        {
            var go = new GameObject(n["unity"]["name"].Str ?? n["name"].Str, typeof(RectTransform));
            go.layer = LayerMask.NameToLayer("UI");
            go.transform.SetParent(parent, false);
            if (useUndo) Undo.RegisterCreatedObjectUndo(go, Title);
            created[n.v] = go;
            objectCount++;
            Configure(go, n);
            return go;
        }

        internal J LayoutOf(J n) => n.Has("layout") ? layout["layouts"][n["layout"].I] : new J(null);

        List<string> ItemsOf(J n) => LayoutOf(n)["items"].Items.Select(x => x.Str).ToList();

        /// <summary>子が親の並び（LayoutGroup）の項目か。項目の位置は LayoutGroup が決める</summary>
        internal bool IsLayoutItem(J parent, J child) => parent != null && parent.Has("layout") && ItemsOf(parent).Contains(child["name"].Str);

        /// <summary>
        /// 子の並び。ふつうは tree の順（下から上 = Unity で後のものが前に描かれる）。
        /// 並び（LayoutGroup）のグループは、並べる順（layouts[].items）を先にし、項目でないものを後ろに置く。
        /// </summary>
        internal IEnumerable<J> OrderedChildren(J n)
        {
            var kids = n["children"].Items.ToList();
            if (!n.Has("layout")) return kids;
            var items = ItemsOf(n);
            return kids.Where(k => items.Contains(k["name"].Str)).OrderBy(k => items.IndexOf(k["name"].Str))
                .Concat(kids.Where(k => !items.Contains(k["name"].Str)));
        }

        // 並びのグループの中で、項目でない子は LayoutGroup の対象から外す
        internal void ApplyLayoutIgnore(J n, GameObject go)
        {
            if (!n.Has("layout")) return;
            foreach (var c in n["children"].Items)
                if (!IsLayoutItem(n, c) && created.TryGetValue(c.v, out var cg) && cg != null)
                {
                    var le = Get<LayoutElement>(cg);
                    le.ignoreLayout = true;
                    Done(le);
                }
        }

        /// <summary>部品の値（位置・画像・文字・並び・不透明度）をすべて GameObject に入れる</summary>
        internal void Configure(GameObject go, J n)
        {
            SetRect(go, n, true);
            SetImageOf(go, n);
            if (n["role"].Str == "text")
            {
                SetTextContent(go, n);
                SetTextStyle(go, n);
            }
            if (n["role"].Str == "group")
            {
                if (n.Has("layout")) SetLayout(go, n);
                if (Opacity(n) < 0.999f || go.TryGetComponent<CanvasGroup>(out _)) SetGroupAlpha(go, n);
            }
        }

        internal static float Opacity(J n) => n.Has("opacity") ? n["opacity"].F : 1f;

        /// <summary>RectTransform。position が false なら大きさだけ（並びの項目は位置を LayoutGroup が決める）</summary>
        internal void SetRect(GameObject go, J n, bool position)
        {
            var u = n["unity"];
            var rt = Get<RectTransform>(go);
            if (position)
            {
                rt.anchorMin = u["anchorMin"].V2;
                rt.anchorMax = u["anchorMax"].V2;
                rt.pivot = u["pivot"].V2;
                rt.anchoredPosition = u["anchoredPosition"].V2;
            }
            rt.sizeDelta = u["sizeDelta"].V2;
            rt.localScale = Vector3.one;
            rt.localRotation = Quaternion.identity;
            Done(rt);
        }

        /// <summary>部品の画像（image なら image、group なら base_image）。無ければ何もしない</summary>
        internal static J ImageNode(J n) => n["role"].Str == "image" ? n["image"] : n["role"].Str == "group" ? n["base_image"]["image"] : new J(null);
        internal static bool HasImage(J n) => n["role"].Str == "image" || (n["role"].Str == "group" && !n["base_image"].IsNull);

        internal void SetImageOf(GameObject go, J n)
        {
            if (!HasImage(n)) return;
            // 画像には不透明度が焼き込まれている
            var name = n["role"].Str == "image" ? n["name"].Str : n["base_image"]["name"].Str;
            SetImage(go, ImageNode(n), n["rect"].Rect, name);
        }

        /// <summary>画像が置かれている GameObject（枠からはみ出した絵は子の "Image"）</summary>
        internal static Image ImageComponent(GameObject go)
        {
            var child = go.transform.Find("Image");
            if (child != null && child.TryGetComponent<Image>(out var ci)) return ci;
            return go.TryGetComponent<Image>(out var i) ? i : null;
        }

        void SetImage(GameObject go, J img, RectInt nodeRect, string name)
        {
            if (img.IsNull) { notes.Add($"画像がありません（絵が無いレイヤー）: {name}"); return; }
            var file = img["file"].Str;
            if (!sprites.TryGetValue(file, out var sprite))
            {
                sprite = AssetDatabase.LoadAssetAtPath<Sprite>($"{screenAssets}/Images/{Path.GetFileName(file)}");
                if (sprite == null) { notes.Add($"Sprite がありません: {file}"); return; }
                sprites[file] = sprite;
            }
            var r = img["rect"].Rect;
            var target = go;
            if (!r.Equals(nodeRect))
            {
                // 絵が枠からはみ出した画像: 部品の大きさは枠のまま、絵だけ子に置いてはみ出させる
                var child = go.transform.Find("Image");
                if (child != null) target = child.gameObject;
                else
                {
                    target = new GameObject("Image", typeof(RectTransform));
                    target.layer = LayerMask.NameToLayer("UI");
                    target.transform.SetParent(go.transform, false);
                    if (useUndo) Undo.RegisterCreatedObjectUndo(target, Title);
                }
                var crt = Get<RectTransform>(target);
                crt.anchorMin = crt.anchorMax = crt.pivot = new Vector2(0.5f, 0.5f);
                crt.anchoredPosition = new Vector2(r.x + r.width / 2f - (nodeRect.x + nodeRect.width / 2f),
                                                   -(r.y + r.height / 2f - (nodeRect.y + nodeRect.height / 2f)));
                crt.sizeDelta = new Vector2(r.width, r.height);
                Done(crt);
                notes.Add($"絵が枠からはみ出しているので、子の Image に置きました: {name}");
            }
            var image = Get<Image>(target);
            image.sprite = sprite;
            image.type = Image.Type.Simple;
            image.preserveAspect = false;
            image.color = Color.white;
            Done(image);
        }

        internal void SetTextContent(GameObject go, J n)
        {
            var tmp = Get<TextMeshProUGUI>(go);
            tmp.text = n["text"]["content"].Str ?? "";
            Done(tmp);
        }

        internal void SetTextStyle(GameObject go, J n)
        {
            var t = n["text"];
            var tmp = Get<TextMeshProUGUI>(go);
            if (t["size"].F > 0) tmp.fontSize = t["size"].F;
            tmp.color = TextColor(n);
            switch (t["align"].Str)
            {
                case "center": tmp.horizontalAlignment = HorizontalAlignmentOptions.Center; break;
                case "right": tmp.horizontalAlignment = HorizontalAlignmentOptions.Right; break;
                default: tmp.horizontalAlignment = HorizontalAlignmentOptions.Left; break;
            }
            tmp.verticalAlignment = VerticalAlignmentOptions.Middle;
            // フォントが PSD と違うので、枠に収まらなくても折り返さず、はみ出して見せる
            tmp.textWrappingMode = TextWrappingModes.NoWrap;
            tmp.overflowMode = TextOverflowModes.Overflow;
            tmp.raycastTarget = false;
            Done(tmp);
        }

        // 文字の色。不透明度は焼き込まれていないので色の alpha に入れる
        internal static Color TextColor(J n)
        {
            var color = Color.white;
            var s = n["text"]["color"].Str;
            if (s != null && ColorUtility.TryParseHtmlString(s, out var c)) color = c;
            color.a = Opacity(n);
            return color;
        }

        internal void SetLayout(GameObject go, J n)
        {
            var l = LayoutOf(n);
            var horizontal = l["axis"].Str == "horizontal";
            HorizontalOrVerticalLayoutGroup g = horizontal ? (HorizontalOrVerticalLayoutGroup)Get<HorizontalLayoutGroup>(go) : Get<VerticalLayoutGroup>(go);
            g.spacing = l["spacing"].F;                            // 項目の外形同士のすき間
            var p = l["padding_lrtb"];
            g.padding = new RectOffset(p[0].I, p[1].I, p[2].I, p[3].I);
            g.childAlignment = TextAnchor.UpperLeft;
            g.childControlWidth = g.childControlHeight = false;    // 項目の大きさは項目に任せる
            g.childForceExpandWidth = g.childForceExpandHeight = false;
            Done(g);
        }

        // グループの不透明度は画像に焼き込まれていないので、CanvasGroup で当てる
        internal void SetGroupAlpha(GameObject go, J n)
        {
            var cg = Get<CanvasGroup>(go);
            cg.alpha = Opacity(n);
            Done(cg);
        }

        // ------------------------------------------------------------------ Prefab
        /// <summary>
        /// _Prefab（prefabs[] の explicit）ごとに Prefab を 1 つ作る。基準は違いの無いインスタンス（variant でないもの）。
        /// ほかのインスタンスは Prefab から置き直し、位置・画像・文字などを差し替える。
        /// Prefab に無い部品は元の GameObject を移し（追加）、インスタンスに無い部品は非表示にする。
        /// 中に入れ子の Prefab があるときに備えて、深いものから作る。
        /// </summary>
        int BuildPrefabs()
        {
            var byPath = new Dictionary<string, J>();
            void Index(J n) { if (n["path"].Str != null) byPath[n["path"].Str] = n; foreach (var c in n["children"].Items) Index(c); }
            Index(layout["tree"]);

            var list = layout["prefabs"].Items.Where(p => p["explicit"].B)
                .Select(p => (pf: p, members: p["paths"].Items.Select(x => byPath.TryGetValue(x.Str, out var m) ? m : null).Where(m => m != null).ToList()))
                .Where(x => x.members.Count > 0)
                .OrderByDescending(x => x.members[0]["path"].Str.Count(ch => ch == '/'))
                .ToList();

            var dir = $"{screenAssets}/Prefabs";
            Directory.CreateDirectory(dir);
            var count = 0;
            foreach (var (pf, members) in list)
            {
                var baseNode = members.FirstOrDefault(m => !m["prefab"]["variant"].B) ?? members[0];
                if (!created.TryGetValue(baseNode.v, out var baseGo) || baseGo == null) continue;
                var path = $"{dir}/{SafeName(pf["name"].Str ?? baseGo.name)}.prefab";
                var asset = PrefabUtility.SaveAsPrefabAssetAndConnect(baseGo, path, InteractionMode.AutomatedAction);
                if (asset == null) { notes.Add($"Prefab を作れませんでした: {path}"); continue; }
                count++;
                foreach (var m in members)
                {
                    if (m == baseNode || !created.TryGetValue(m.v, out var old) || old == null) continue;
                    var parent = old.transform.parent;
                    var inst = (GameObject)PrefabUtility.InstantiatePrefab(asset, parent);
                    inst.transform.SetSiblingIndex(old.transform.GetSiblingIndex());
                    Apply(inst, m);
                    Object.DestroyImmediate(old);
                }
            }
            return count;
        }

        /// <summary>Prefab のインスタンス（またはその中の部品）に、部品 n の値を入れる</summary>
        void Apply(GameObject go, J n)
        {
            SetName(go, n["unity"]["name"].Str ?? go.name);
            Configure(go, n);
            created[n.v] = go;
            var used = new HashSet<Transform>();
            var kids = OrderedChildren(n).ToList();
            // Prefab の中の部品と対応付ける。まず同じ名前、無ければ同じ位置の同じ種類の部品
            // （インスタンスごとに中の名前が違う。例 Gacha の中は Icon_Footer_Gacha、Shop の中は Icon_Footer_Shop）
            var match = new Dictionary<object, Transform>();
            foreach (var c in kids)
            {
                var t = FindChild(go.transform, c["unity"]["name"].Str, used);
                if (t != null) { match[c.v] = t; used.Add(t); }
            }
            var prefabKids = go.transform.Cast<Transform>().Where(t => t.name != "Image").ToList();
            for (var i = 0; i < kids.Count && i < prefabKids.Count; i++)
            {
                var c = kids[i]; var t = prefabKids[i];
                if (match.ContainsKey(c.v) || used.Contains(t) || Kind(t.gameObject) != c["role"].Str) continue;
                match[c.v] = t; used.Add(t);
            }
            foreach (var c in kids)
            {
                if (match.TryGetValue(c.v, out var t))
                {
                    Apply(t.gameObject, c);
                }
                else if (created.TryGetValue(c.v, out var src) && src != null)
                {
                    // Prefab に無い部品（このインスタンスだけにある）: 作ってあったものを移す
                    src.transform.SetParent(go.transform, false);
                    used.Add(src.transform);
                }
            }
            // Prefab にあって、このインスタンスに無い部品は非表示にする（"Image" は枠からはみ出した絵の置き場なので残す）
            foreach (Transform t in go.transform)
                if (!used.Contains(t) && t.name != "Image") SetActive(t.gameObject, false);
            ApplyLayoutIgnore(n, go);
        }

        // GameObject の種類（layout.json の role に合わせる）
        static string Kind(GameObject go) =>
            go.TryGetComponent<TextMeshProUGUI>(out _) ? "text"
            : go.transform.Cast<Transform>().All(t => t.name == "Image") && (go.TryGetComponent<Image>(out _) || go.transform.childCount > 0) ? "image" : "group";

        static Transform FindChild(Transform parent, string name, HashSet<Transform> used)
        {
            foreach (Transform t in parent) if (t.name == name && !used.Contains(t)) return t;
            return null;
        }

        // ------------------------------------------------------------------ 変更の記録（取り消し・Prefab のインスタンスの差し替え）
        /// <summary>コンポーネントを取る（無ければ足す）。反映では取り消せるように記録する</summary>
        internal T Get<T>(GameObject go) where T : Component
        {
            if (go.TryGetComponent<T>(out var c))
            {
                if (useUndo) Undo.RecordObject(c, Title);
                return c;
            }
            return useUndo ? Undo.AddComponent<T>(go) : go.AddComponent<T>();
        }

        /// <summary>
        /// 値を変えた後に呼ぶ。Prefab のインスタンスでは、スクリプトで変えた値を「インスタンスの差し替え」として残すために必要
        /// （これが無いと、シーンを開き直したときに Prefab の値に戻る）
        /// </summary>
        internal static void Done(Object o)
        {
            if (o != null && PrefabUtility.IsPartOfPrefabInstance(o)) PrefabUtility.RecordPrefabInstancePropertyModifications(o);
        }

        internal void SetName(GameObject go, string name)
        {
            if (go.name == name) return;
            if (useUndo) Undo.RecordObject(go, Title);
            go.name = name;
            Done(go);
        }

        internal void SetActive(GameObject go, bool active)
        {
            if (go.activeSelf == active) return;
            if (useUndo) Undo.RecordObject(go, Title);
            go.SetActive(active);
            Done(go);
        }

        // ------------------------------------------------------------------ そのほか
        internal static void EnsureEventSystem()
        {
            if (Object.FindFirstObjectByType<EventSystem>() != null) return;
            var es = new GameObject("EventSystem", typeof(EventSystem));
            // Input System が入っていればその入力モジュール、無ければ旧来のもの
            var module = Type.GetType("UnityEngine.InputSystem.UI.InputSystemUIInputModule, Unity.InputSystem");
            if (module != null) es.AddComponent(module);
            else es.AddComponent<StandaloneInputModule>();
            Undo.RegisterCreatedObjectUndo(es, $"{Title}: EventSystem");
        }

        /// <summary>
        /// 取り込みの記録（どの版を取り込んだか）と、取り込んだ layout.json の写し（反映で「前に取り込んだ値」に使う）
        /// </summary>
        internal void WriteRecord(string scenePath)
        {
            Directory.CreateDirectory(screenAssets);
            var path = $"{screenAssets}/{RecordName}";
            var json = "{\n" +
                       $"  \"screen\": \"{Esc(screen)}\",\n" +
                       $"  \"version\": \"{Esc(layout["version"].Str)}\",\n" +
                       $"  \"psd_file\": \"{Esc(layout["psd_file"].Str)}\",\n" +
                       $"  \"imported_at\": \"{DateTime.Now:yyyy-MM-ddTHH:mm:ss}\",\n" +
                       $"  \"scene\": \"{Esc(scenePath)}\",\n" +
                       $"  \"tool_version\": \"{Esc(PackageVersion())}\"\n" +
                       "}\n";
            File.WriteAllText(path, json, new UTF8Encoding(false));
            File.Copy(Path.Combine(screenDir, "layout.json"), $"{screenAssets}/{LayoutCopyName}", true);
            AssetDatabase.ImportAsset(path);
            AssetDatabase.ImportAsset($"{screenAssets}/{LayoutCopyName}");
        }

        static string PackageVersion()
        {
            var info = UnityEditor.PackageManager.PackageInfo.FindForAssembly(typeof(UiBuilder).Assembly);
            return info != null ? info.version : "";
        }

        internal static string Esc(string s) => (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\n", "\\n");

        static string SafeName(string s)
        {
            foreach (var c in Path.GetInvalidFileNameChars()) s = s.Replace(c, '_');
            return s;
        }
    }
}
