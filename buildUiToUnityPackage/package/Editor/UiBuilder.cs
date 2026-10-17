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
    /// </summary>
    public class UiBuilder
    {
        readonly string screenDir;     // UIExport/<画面ID>（Assets の外）
        readonly string assetRoot;     // 例 Assets/UI
        J layout;
        string screen;
        string screenAssets;           // 例 Assets/UI/Home
        readonly Dictionary<string, Sprite> sprites = new Dictionary<string, Sprite>();
        readonly Dictionary<object, GameObject> created = new Dictionary<object, GameObject>();   // 部品（JSON の値）→ 作った GameObject
        readonly List<string> notes = new List<string>();
        int objectCount;

        UiBuilder(string screenDir, string assetRoot)
        {
            this.screenDir = screenDir;
            this.assetRoot = assetRoot.TrimEnd('/');
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
                EditorUtility.DisplayDialog("Build UI To Unity", "取り込み中にエラーが出ました。コンソールの内容を送ってください。\n\n" + e.Message, "OK");
            }
            finally
            {
                EditorUtility.ClearProgressBar();
            }
        }

        void Run(SceneTarget target)
        {
            layout = Json.Parse(File.ReadAllText(Path.Combine(screenDir, "layout.json"), Encoding.UTF8));
            screen = layout["screen"].Str ?? Path.GetFileName(screenDir);
            screenAssets = $"{assetRoot}/{screen}";
            var version = layout["version"].Str;

            // エラーのある版は、取り込む前に確かめる（書き出しは止めない決まりなので、最終決定の取り込みで止める）
            var errors = layout["issues"].Items.Count(i => i["level"].Str == "error");
            if (errors > 0 && !EditorUtility.DisplayDialog("Build UI To Unity",
                    $"{screen} の版 {version} には、エラーが {errors} 件あります。\n取り込むと構造が崩れる可能性があります。取り込みますか？",
                    "取り込む", "やめる"))
                return;

            // 文字に TextMeshPro の既定のフォントを使う
            if (Resources.Load<TMP_Settings>("TMP Settings") == null)
            {
                EditorUtility.DisplayDialog("Build UI To Unity",
                    "TextMeshPro の基本データが入っていません。\nメニューの Window > TextMeshPro > Import TMP Essential Resources を実行してから、もう一度取り込んでください。", "OK");
                return;
            }

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
                    var choice = EditorUtility.DisplayDialogComplex("Build UI To Unity",
                        $"このシーンには、すでに「{screen}」があります。", "置き換える", "やめる", "並べて追加");
                    if (choice == 1) return;
                    if (choice == 0) Undo.DestroyObjectImmediate(existing);
                }
            }

            EditorUtility.DisplayProgressBar("Build UI To Unity", "画像を取り込み中…", 0.1f);
            ImportImages();

            EditorUtility.DisplayProgressBar("Build UI To Unity", "画面を組み立て中…", 0.5f);
            var root = BuildRoot();
            if (target == SceneTarget.Current) Undo.RegisterCreatedObjectUndo(root, $"Build UI To Unity: {screen}");

            EditorUtility.DisplayProgressBar("Build UI To Unity", "Prefab を作成中…", 0.7f);
            var prefabCount = BuildPrefabs();

            EnsureEventSystem();
            WriteRecord(scene, newScenePath ?? scene.path);

            if (newScenePath != null) EditorSceneManager.SaveScene(scene, newScenePath);
            else EditorSceneManager.MarkSceneDirty(scene);
            Selection.activeGameObject = root;
            EditorGUIUtility.PingObject(root);

            var msg = $"{screen}（版 {version}）を取り込みました。\n部品 {objectCount} 個 / 画像 {sprites.Count} 枚 / Prefab {prefabCount} 個\n" +
                      (newScenePath != null ? $"シーン: {newScenePath}" : "今のシーンに追加しました（保存はまだです）");
            if (notes.Count > 0) msg += "\n\n" + string.Join("\n", notes.Take(10)) + (notes.Count > 10 ? $"\nほか {notes.Count - 10} 件（コンソール）" : "");
            foreach (var n in notes) Debug.Log("[Build UI To Unity] " + n);
            EditorUtility.DisplayDialog("Build UI To Unity", msg, "OK");
        }

        // ------------------------------------------------------------------ 画像
        void ImportImages()
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
            var go = new GameObject(n["unity"]["name"].Str ?? n["name"].Str, typeof(RectTransform));
            go.layer = LayerMask.NameToLayer("UI");
            go.transform.SetParent(parent, false);
            created[n.v] = go;
            objectCount++;
            Configure(go, n);
            foreach (var c in OrderedChildren(n)) Build(c, go.transform);
            ApplyLayoutIgnore(n, go);
            return go;
        }

        /// <summary>
        /// 子の並び。ふつうは tree の順（下から上 = Unity で後のものが前に描かれる）。
        /// 並び（LayoutGroup）のグループは、並べる順（layouts[].items）を先にし、項目でないものを後ろに置く。
        /// </summary>
        IEnumerable<J> OrderedChildren(J n)
        {
            var kids = n["children"].Items.ToList();
            if (!n.Has("layout")) return kids;
            var items = layout["layouts"][n["layout"].I]["items"].Items.Select(x => x.Str).ToList();
            return kids.Where(k => items.Contains(k["name"].Str)).OrderBy(k => items.IndexOf(k["name"].Str))
                .Concat(kids.Where(k => !items.Contains(k["name"].Str)));
        }

        // 並びのグループの中で、項目でない子は LayoutGroup の対象から外す
        void ApplyLayoutIgnore(J n, GameObject go)
        {
            if (!n.Has("layout")) return;
            var items = layout["layouts"][n["layout"].I]["items"].Items.Select(x => x.Str).ToList();
            foreach (var c in n["children"].Items)
                if (!items.Contains(c["name"].Str) && created.TryGetValue(c.v, out var cg))
                    Get<LayoutElement>(cg).ignoreLayout = true;
        }

        /// <summary>部品の値（位置・画像・文字・並び・不透明度）を GameObject に入れる。Prefab のインスタンスの差し替えにも使う</summary>
        void Configure(GameObject go, J n)
        {
            var u = n["unity"];
            var rt = (RectTransform)go.transform;
            rt.anchorMin = u["anchorMin"].V2;
            rt.anchorMax = u["anchorMax"].V2;
            rt.pivot = u["pivot"].V2;
            rt.anchoredPosition = u["anchoredPosition"].V2;
            rt.sizeDelta = u["sizeDelta"].V2;
            rt.localScale = Vector3.one;
            rt.localRotation = Quaternion.identity;

            var opacity = n.Has("opacity") ? n["opacity"].F : 1f;
            switch (n["role"].Str)
            {
                case "image":
                    // 画像には不透明度が焼き込まれている
                    SetImage(go, n["image"], n["rect"].Rect, n["name"].Str);
                    break;
                case "text":
                    SetText(go, n["text"], opacity);
                    break;
                case "group":
                    if (!n["base_image"].IsNull) SetImage(go, n["base_image"]["image"], n["rect"].Rect, n["base_image"]["name"].Str);
                    if (n.Has("layout")) SetLayout(go, layout["layouts"][n["layout"].I]);
                    // グループの不透明度は画像に焼き込まれていないので、CanvasGroup で当てる
                    if (opacity < 0.999f) Get<CanvasGroup>(go).alpha = opacity;
                    break;
            }
        }

        void SetImage(GameObject go, J img, RectInt nodeRect, string name)
        {
            if (img.IsNull) { notes.Add($"画像がありません（絵が無いレイヤー）: {name}"); return; }
            var file = img["file"].Str;
            if (!sprites.TryGetValue(file, out var sprite)) { notes.Add($"Sprite がありません: {file}"); return; }
            var r = img["rect"].Rect;
            var target = go;
            if (!r.Equals(nodeRect))
            {
                // 絵が枠からはみ出した画像: 部品の大きさは枠のまま、絵だけ子に置いてはみ出させる
                var child = go.transform.Find("Image");
                target = child != null ? child.gameObject : new GameObject("Image", typeof(RectTransform));
                target.layer = LayerMask.NameToLayer("UI");
                target.transform.SetParent(go.transform, false);
                var crt = (RectTransform)target.transform;
                crt.anchorMin = crt.anchorMax = crt.pivot = new Vector2(0.5f, 0.5f);
                crt.anchoredPosition = new Vector2(r.x + r.width / 2f - (nodeRect.x + nodeRect.width / 2f),
                                                   -(r.y + r.height / 2f - (nodeRect.y + nodeRect.height / 2f)));
                crt.sizeDelta = new Vector2(r.width, r.height);
                notes.Add($"絵が枠からはみ出しているので、子の Image に置きました: {name}");
            }
            var image = Get<Image>(target);
            image.sprite = sprite;
            image.type = Image.Type.Simple;
            image.preserveAspect = false;
            image.color = Color.white;
        }

        void SetText(GameObject go, J t, float opacity)
        {
            var tmp = Get<TextMeshProUGUI>(go);
            tmp.text = t["content"].Str ?? "";
            if (t["size"].F > 0) tmp.fontSize = t["size"].F;
            var color = Color.white;
            if (t["color"].Str != null && ColorUtility.TryParseHtmlString(t["color"].Str, out var c)) color = c;
            color.a = opacity;   // 文字の不透明度は焼き込まれていない
            tmp.color = color;
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
        }

        static void SetLayout(GameObject go, J l)
        {
            var horizontal = l["axis"].Str == "horizontal";
            HorizontalOrVerticalLayoutGroup g = horizontal ? (HorizontalOrVerticalLayoutGroup)Get<HorizontalLayoutGroup>(go) : Get<VerticalLayoutGroup>(go);
            g.spacing = l["spacing"].F;                            // 項目の外形同士のすき間
            var p = l["padding_lrtb"];
            g.padding = new RectOffset(p[0].I, p[1].I, p[2].I, p[3].I);
            g.childAlignment = TextAnchor.UpperLeft;
            g.childControlWidth = g.childControlHeight = false;    // 項目の大きさは項目に任せる
            g.childForceExpandWidth = g.childForceExpandHeight = false;
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
            go.name = n["unity"]["name"].Str ?? go.name;
            Configure(go, n);
            var used = new HashSet<Transform>();
            foreach (var c in n["children"].Items)
            {
                var name = c["unity"]["name"].Str;
                var t = FindChild(go.transform, name, used);
                if (t != null)
                {
                    used.Add(t);
                    created[c.v] = t.gameObject;
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
                if (!used.Contains(t) && t.name != "Image") t.gameObject.SetActive(false);
            if (n.Has("layout"))
            {
                var items = layout["layouts"][n["layout"].I]["items"].Items.Select(x => x.Str).ToList();
                foreach (var c in n["children"].Items)
                    if (!items.Contains(c["name"].Str) && created.TryGetValue(c.v, out var cg) && cg != null)
                        Get<LayoutElement>(cg).ignoreLayout = true;
            }
        }

        static Transform FindChild(Transform parent, string name, HashSet<Transform> used)
        {
            foreach (Transform t in parent) if (t.name == name && !used.Contains(t)) return t;
            return null;
        }

        // ------------------------------------------------------------------ そのほか
        static void EnsureEventSystem()
        {
            if (Object.FindFirstObjectByType<EventSystem>() != null) return;
            var es = new GameObject("EventSystem", typeof(EventSystem));
            // Input System が入っていればその入力モジュール、無ければ旧来のもの
            var module = Type.GetType("UnityEngine.InputSystem.UI.InputSystemUIInputModule, Unity.InputSystem");
            if (module != null) es.AddComponent(module);
            else es.AddComponent<StandaloneInputModule>();
            Undo.RegisterCreatedObjectUndo(es, "Build UI To Unity: EventSystem");
        }

        // 取り込みの記録（どの版を取り込んだか。段階 2 の再取り込みで使う）
        void WriteRecord(Scene scene, string scenePath)
        {
            var path = $"{screenAssets}/BuildUiToUnity_record.json";
            var json = "{\n" +
                       $"  \"screen\": \"{Esc(screen)}\",\n" +
                       $"  \"version\": \"{Esc(layout["version"].Str)}\",\n" +
                       $"  \"psd_file\": \"{Esc(layout["psd_file"].Str)}\",\n" +
                       $"  \"imported_at\": \"{DateTime.Now:yyyy-MM-ddTHH:mm:ss}\",\n" +
                       $"  \"scene\": \"{Esc(scenePath)}\",\n" +
                       $"  \"tool_version\": \"{Esc(PackageVersion())}\"\n" +
                       "}\n";
            File.WriteAllText(path, json, new UTF8Encoding(false));
            AssetDatabase.ImportAsset(path);
        }

        static string PackageVersion()
        {
            var info = UnityEditor.PackageManager.PackageInfo.FindForAssembly(typeof(UiBuilder).Assembly);
            return info != null ? info.version : "";
        }

        static string Esc(string s) => (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"");

        static string SafeName(string s)
        {
            foreach (var c in Path.GetInvalidFileNameChars()) s = s.Replace(c, '_');
            return s;
        }

        static T Get<T>(GameObject go) where T : Component => go.TryGetComponent<T>(out var c) ? c : go.AddComponent<T>();
    }
}
