import UIKit

/// iPhones have no Back key. A swipe in from either side edge is the remote's
/// Back: it fires the same Capacitor "backButton" event Android sends, so every
/// screen's own Back handling runs unchanged (one swipe = one step back).
/// An arrow follows the thumb in from the edge, like Android's back gesture,
/// and a light tick says the swipe has gone far enough to count.
final class SMCBackGesture: NSObject, UIGestureRecognizerDelegate {

    /// How far the thumb must travel in from the edge for the swipe to count.
    private static let threshold: CGFloat = 70

    private weak var host: UIView?
    private let fire: () -> Void
    private let arrow = SMCBackArrow()
    private let haptic = UIImpactFeedbackGenerator(style: .light)
    private var armed = false

    init(on view: UIView, fire: @escaping () -> Void) {
        self.host = view
        self.fire = fire
        super.init()
        for edge in [UIRectEdge.left, .right] {
            let g = UIScreenEdgePanGestureRecognizer(target: self, action: #selector(pan(_:)))
            g.edges = edge
            g.delegate = self
            view.addGestureRecognizer(g)
        }
        arrow.isHidden = true
        view.addSubview(arrow)
    }

    @objc private func pan(_ g: UIScreenEdgePanGestureRecognizer) {
        guard let host = host else { return }
        let fromLeft = g.edges == .left
        let inward: CGFloat = fromLeft ? 1 : -1
        let dx = g.translation(in: host).x * inward
        let y = g.location(in: host).y
        switch g.state {
        case .began:
            armed = false
            haptic.prepare()
            arrow.show(fromLeft: fromLeft, y: y, in: host.bounds)
        case .changed:
            let nowArmed = dx >= Self.threshold
            if nowArmed && !armed { haptic.impactOccurred() }
            armed = nowArmed
            arrow.update(progress: max(0, min(1, dx / Self.threshold)), armed: armed, y: y)
        case .ended:
            // A quick flick counts a little short of the line.
            let flick = dx > Self.threshold * 0.6 && g.velocity(in: host).x * inward > 600
            let go = armed || flick
            arrow.hide()
            armed = false
            if go { fire() }
        default:
            arrow.hide()
            armed = false
        }
    }

    // The page's own scrolling waits until an edge swipe has been ruled out,
    // so a swipe from the edge never also scrolls the list under the thumb.
    func gestureRecognizer(_ g: UIGestureRecognizer, shouldBeRequiredToFailBy other: UIGestureRecognizer) -> Bool {
        other is UIPanGestureRecognizer && !(other is UIScreenEdgePanGestureRecognizer)
    }
}

/// The round arrow that slides in with the thumb.
private final class SMCBackArrow: UIView {
    private static let size: CGFloat = 44
    private static let accent = UIColor(red: 63 / 255, green: 169 / 255, blue: 245 / 255, alpha: 0.95)

    private let blur = UIVisualEffectView(effect: UIBlurEffect(style: .systemThinMaterialDark))
    private let icon = UIImageView(image: UIImage(
        systemName: "chevron.left",
        withConfiguration: UIImage.SymbolConfiguration(pointSize: 18, weight: .bold)))
    private var fromLeft = true
    private var hostBounds = CGRect.zero

    init() {
        super.init(frame: CGRect(x: 0, y: 0, width: Self.size, height: Self.size))
        isUserInteractionEnabled = false
        layer.cornerRadius = Self.size / 2
        clipsToBounds = true
        blur.frame = bounds
        blur.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        addSubview(blur)
        icon.tintColor = .white
        icon.contentMode = .center
        icon.frame = bounds
        icon.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        addSubview(icon)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    func show(fromLeft: Bool, y: CGFloat, in bounds: CGRect) {
        self.fromLeft = fromLeft
        hostBounds = bounds
        layer.removeAllAnimations()
        superview?.bringSubviewToFront(self)
        isHidden = false
        update(progress: 0, armed: false, y: y)
    }

    func update(progress: CGFloat, armed: Bool, y: CGFloat) {
        let s = Self.size
        // From half off the edge to a little way in.
        let inset = -s / 2 + progress * (s / 2 + 24)
        let x = fromLeft ? inset + s / 2 : hostBounds.width - inset - s / 2
        center = CGPoint(x: x, y: min(max(y, s), hostBounds.height - s))
        alpha = min(1, progress * 1.5)
        let scale = 0.7 + 0.3 * progress
        transform = CGAffineTransform(scaleX: scale, y: scale)
        blur.isHidden = armed
        backgroundColor = armed ? Self.accent : .clear
    }

    func hide() {
        UIView.animate(withDuration: 0.15, animations: { self.alpha = 0 }, completion: { done in
            if done { self.isHidden = true }
        })
    }
}
