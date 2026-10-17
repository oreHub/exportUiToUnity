using UnityEngine;

/// <summary>
/// 再取り込み（段階 2）の確認用のダミー。エンジニアがフッターの各ボタンに付けるスクリプトのつもり。
/// 押されたら、親の DevFooterMenu に遷移を頼む。
/// </summary>
public class DevFooterButton : MonoBehaviour
{
    public string label;
    public int badgeCount;

    public void OnClick()
    {
        var menu = GetComponentInParent<DevFooterMenu>();
        if (menu != null) menu.Go(gameObject);
        else Debug.Log($"[Dev] {label}: DevFooterMenu が見つかりません");
    }
}
