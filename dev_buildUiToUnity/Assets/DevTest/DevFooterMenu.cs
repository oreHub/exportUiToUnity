using System;
using System.Collections.Generic;
using UnityEngine;

/// <summary>
/// 再取り込み（段階 2）の確認用のダミー。エンジニアが Footer に付けるスクリプトのつもり。
/// 並んでいるボタンのリストと、押したときの遷移先を持つ。
/// </summary>
public class DevFooterMenu : MonoBehaviour
{
    [Serializable]
    public class Entry
    {
        public GameObject button;
        public string destination;
    }

    public List<Entry> entries = new List<Entry>();

    public void Go(GameObject button)
    {
        var e = entries.Find(x => x.button == button);
        Debug.Log(e != null ? $"[Dev] {e.destination} へ遷移" : $"[Dev] 登録されていないボタン: {button.name}");
    }
}
