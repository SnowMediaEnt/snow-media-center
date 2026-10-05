import UIKit

/// iPhones have no Back key. A swipe in from either side edge is one press of
/// the remote's Back, delivered the way Android delivers it
/// (SMCViewController.pressBack), so every screen's own Back handling runs
/// unchanged: one swipe = one step back.
/// An arrow follows the thumb in from the edge, like Android's back gesture,
/// and a light tick says the swipe has gone far enough to count.
final class SMCBackGesture: NSObject, UIGestureRecognizerDelegate {

    /// How far the thumb must travel in from the edge for the swipe to count.
    private static let threshold: CGFloat = 70
    /// A swipe has to start this close to the left or right edge: past the
    /// side's safe area (the rounded corners and the Dynamic Island, where a
    /// thumb hardly lands), plus a margin, and never less than a thumb's width.
    /// 24 pt was too tight on the owner's iPhone 18 Pro Max: no swipe ever started.
    private static func edgeZone(inset: CGFloat) -> CGFloat {
        min(80, max(44, inset + 16))
    }

    private weak var host: UIView?
    private let fire: () -> Void
    private let arrow = SMCBackArrow()
    private let haptic = UIImpactFeedbackGenerator(style: .light)
    private var recognizer: UIPanGestureRecognizer?
    private var fromLeft = true
    private var armed = false

    init(on view: UIView, fire: @escaping () -> Void) {
        self.host = view
        self.fire = fire
        super.init()
        // A plain pan that only starts at a side edge, not a
        // UIScreenEdgePanGestureRecognizer: the same on a phone, and it also
        // answers the simulator's touches, so it can be tested there.
        let g = UIPanGestureRecognizer(target: self, action: #selector(pan(_:)))
        g.delegate = self
        g.maximumNumberOfTouches = 1
        view.addGestureRecognizer(g)
        recognizer = g
        arrow.isHidden = true
        view.addSubview(arrow)
    }

    @objc private func pan(_ g: UIPanGestureRecognizer) {
        guard let host = host else { return }
        let inward: CGFloat = fromLeft ? 1 : -1
        let dx = g.translation(in: host).x * inward
        let y = g.location(in: host).y
        switch g.state {
        case .began:
            armed = false
            haptic.prepare()
            arrow.show(fromLeft: fromLeft, y: y, in: host.bounds)
            arrow.update(progress: max(0, min(1, dx / Self.threshold)), armed: false, y: y)
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

    /// Only a mostly sideways swipe, inward, that started at a side edge.
    func gestureRecognizerShouldBegin(_ g: UIGestureRecognizer) -> Bool {
        guard g === recognizer, let pan = g as? UIPanGestureRecognizer, let host = host else { return true }
        let t = pan.translation(in: host)
        let start = pan.location(in: host).x - t.x
        // The first reading can be (0, 0); the speed says which way it's going.
        let d = t == .zero ? pan.velocity(in: host) : t
        let w = host.bounds.width
        let insets = host.safeAreaInsets
        if start <= Self.edgeZone(inset: insets.left) && d.x > 0 { fromLeft = true }
        else if start >= w - Self.edgeZone(inset: insets.right) && d.x < 0 { fromLeft = false }
        else { return false }
        return abs(d.x) > abs(d.y)
    }

    // The page's own scrolling waits until an edge swipe has been ruled out,
    // so a swipe from the edge never also scrolls the list under the thumb.
    func gestureRecognizer(_ g: UIGestureRecognizer, shouldBeRequiredToFailBy other: UIGestureRecognizer) -> Bool {
        g === recognizer && other !== recognizer && other is UIPanGestureRecognizer
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
