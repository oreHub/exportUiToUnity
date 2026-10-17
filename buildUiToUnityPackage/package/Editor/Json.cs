using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using UnityEngine;

namespace BuildUiToUnity.Editor
{
    /// <summary>
    /// layout.json を読むための小さな JSON パーサー。
    /// JsonUtility は入れ子の深い木（tree）を扱いにくく、外部のパッケージにも頼らないために自前で持つ。
    /// 値は Dictionary&lt;string, object&gt; / List&lt;object&gt; / string / double / bool / null になる。
    /// </summary>
    static class Json
    {
        public static J Parse(string text)
        {
            var p = new Parser(text);
            p.Ws();
            var v = p.Value();
            p.Ws();
            if (p.i < text.Length) throw p.Error("余分な文字がある");
            return new J(v);
        }

        class Parser
        {
            readonly string s;
            public int i;
            public Parser(string s) { this.s = s; }

            public Exception Error(string m) => new FormatException($"JSON の {i} 文字目: {m}");
            public void Ws() { while (i < s.Length && char.IsWhiteSpace(s[i])) i++; }
            char Peek() { if (i >= s.Length) throw Error("途中で終わっている"); return s[i]; }

            public object Value()
            {
                switch (Peek())
                {
                    case '{': return Obj();
                    case '[': return Arr();
                    case '"': return Str();
                    case 't': Lit("true"); return true;
                    case 'f': Lit("false"); return false;
                    case 'n': Lit("null"); return null;
                    default: return Num();
                }
            }

            void Lit(string w)
            {
                if (i + w.Length > s.Length || string.CompareOrdinal(s, i, w, 0, w.Length) != 0) throw Error($"{w} のはず");
                i += w.Length;
            }

            Dictionary<string, object> Obj()
            {
                var d = new Dictionary<string, object>();
                i++; Ws();
                if (Peek() == '}') { i++; return d; }
                while (true)
                {
                    Ws();
                    if (Peek() != '"') throw Error("キーは文字列のはず");
                    var k = Str();
                    Ws();
                    if (Peek() != ':') throw Error(": が無い");
                    i++; Ws();
                    d[k] = Value();
                    Ws();
                    var c = Peek(); i++;
                    if (c == ',') continue;
                    if (c == '}') return d;
                    throw Error(", か } が無い");
                }
            }

            List<object> Arr()
            {
                var a = new List<object>();
                i++; Ws();
                if (Peek() == ']') { i++; return a; }
                while (true)
                {
                    Ws();
                    a.Add(Value());
                    Ws();
                    var c = Peek(); i++;
                    if (c == ',') continue;
                    if (c == ']') return a;
                    throw Error(", か ] が無い");
                }
            }

            string Str()
            {
                i++;
                var sb = new StringBuilder();
                while (true)
                {
                    var c = Peek(); i++;
                    if (c == '"') return sb.ToString();
                    if (c != '\\') { sb.Append(c); continue; }
                    var e = Peek(); i++;
                    switch (e)
                    {
                        case '"': sb.Append('"'); break;
                        case '\\': sb.Append('\\'); break;
                        case '/': sb.Append('/'); break;
                        case 'b': sb.Append('\b'); break;
                        case 'f': sb.Append('\f'); break;
                        case 'n': sb.Append('\n'); break;
                        case 'r': sb.Append('\r'); break;
                        case 't': sb.Append('\t'); break;
                        case 'u':
                            if (i + 4 > s.Length) throw Error("\\u の後が短い");
                            sb.Append((char)Convert.ToInt32(s.Substring(i, 4), 16)); i += 4; break;
                        default: throw Error("知らないエスケープ");
                    }
                }
            }

            double Num()
            {
                var st = i;
                while (i < s.Length && "+-0123456789.eE".IndexOf(s[i]) >= 0) i++;
                if (st == i) throw Error("値が無い");
                return double.Parse(s.Substring(st, i - st), NumberStyles.Float, CultureInfo.InvariantCulture);
            }
        }
    }

    /// <summary>JSON の値を読みやすくする包み。無い項目は null として読める（例外にしない）。</summary>
    class J
    {
        public readonly object v;
        public J(object v) { this.v = v; }

        public J this[string k] => new J(v is Dictionary<string, object> d && d.TryGetValue(k, out var x) ? x : null);
        public J this[int k] => new J(v is List<object> l && k >= 0 && k < l.Count ? l[k] : null);

        public bool IsNull => v == null;
        public bool Has(string k) => v is Dictionary<string, object> d && d.ContainsKey(k) && d[k] != null;
        public string Str => v as string;
        public float F => v is double d ? (float)d : 0f;
        public int I => v is double d ? (int)Math.Round(d) : 0;
        public bool B => v is bool b && b;
        public int Count => v is List<object> l ? l.Count : 0;
        public IEnumerable<J> Items => v is List<object> l ? l.Select(x => new J(x)) : Enumerable.Empty<J>();
        public Vector2 V2 => new Vector2(this[0].F, this[1].F);

        /// <summary>[左, 上, 幅, 高さ]</summary>
        public RectInt Rect => new RectInt(this[0].I, this[1].I, this[2].I, this[3].I);
    }
}
