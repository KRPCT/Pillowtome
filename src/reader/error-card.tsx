/**
 * 阅读错误卡片（简体中文）。
 *
 * 当 DRM 门（`check_protection`）判定书籍不可渲染——内容加密、不支持的格式、
 * 或文件损坏——阅读视图渲染此卡片，而不是调用 `view.open`（D-10）。
 * 它只负责呈现一条对读者友好的中文提示，绝不崩溃。
 */
export interface ErrorCardProps {
  /** 面向读者的中文提示，例如「无法打开：不支持的加密书籍。」 */
  message: string;
  /** 可选的关闭/返回回调。 */
  onDismiss?: () => void;
}

export function ErrorCard({ message, onDismiss }: ErrorCardProps) {
  return (
    <div className="error-card" role="alert">
      <p className="error-card__icon" aria-hidden="true">
        ⚠
      </p>
      <p className="error-card__message">{message}</p>
      {onDismiss ? (
        <button type="button" className="error-card__dismiss" onClick={onDismiss}>
          返回
        </button>
      ) : null}
    </div>
  );
}

export default ErrorCard;
