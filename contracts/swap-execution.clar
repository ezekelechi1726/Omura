;; swap-execution.clar
;; Omura Swap Execution Contract
;; Handles token-to-token swaps on AMM-style pools with fee, slippage protection, and minimal dispute rollback.

(define-map admin-info
  { key: principal }
  { fee-bps: uint }) ;; basis points fee (e.g., 30 = 0.30%)

(define-map supported-pair
  ;; key is a canonical ordered pair of two token principals
  { token-a: principal, token-b: principal }
  { reserve-a: uint, reserve-b: uint, total-fees-accrued: uint })

(define-data-var paused bool false)

;; Error codes
(define-constant ERR-PAUSED u900)
(define-constant ERR-NOT-ADMIN u100)
(define-constant ERR-UNSUPPORTED-PAIR u101)
(define-constant ERR-INSUFFICIENT-LIQUIDITY u102)
(define-constant ERR-SLIPPAGE-EXCEEDED u103)
(define-constant ERR-ZERO-AMOUNT u104)
(define-constant ERR-ALREADY-INIT u105)

(define-constant DEFAULT-FEE-BPS u30) ;; default protocol fee if caller not admin

;; Utility: canonicalize pair so smaller principal lexicographically is token-a
(define-private (canonical-pair (x principal) (y principal))
  (if (is-eq x y)
      (err ERR-UNSUPPORTED-PAIR)
      (if (<= (as-max-len (to-utf8 x) u100) (as-max-len (to-utf8 y) u100))
          { token-a: x, token-b: y }
          { token-a: y, token-b: x })))

;; Check admin
(define-private (is-admin (caller principal))
  (is-some (map-get? admin-info { key: caller })))

;; Initialize admin and fee; only if no admin exists yet
(define-public (init (new-admin principal) (fee-bps uint))
  (begin
    ;; Prevent re-initialization if this principal already exists
    (asserts! (is-none (map-get? admin-info { key: new-admin })) (err ERR-ALREADY-INIT))
    (map-set admin-info { key: new-admin } { fee-bps: fee-bps })
    (ok true)))

;; Pause / unpause swaps (admin only)
(define-public (set-paused (flag bool))
  (begin
    (asserts! (is-admin tx-sender) (err ERR-NOT-ADMIN))
    (var-set paused flag)
    (ok flag)))

;; Add or update supported AMM pair initial reserves (admin)
(define-public (register-pair (token-x principal) (token-y principal) (reserve-x uint) (reserve-y uint))
  (begin
    (asserts! (not (var-get paused)) (err ERR-PAUSED))
    (asserts! (is-admin tx-sender) (err ERR-NOT-ADMIN))
    (asserts! (>= reserve-x u1) (err ERR-ZERO-AMOUNT))
    (asserts! (>= reserve-y u1) (err ERR-ZERO-AMOUNT))
    (match (canonical-pair token-x token-y)
      canon
        (let ((ta (get token-a canon)) (tb (get token-b canon)))
          (map-set supported-pair
            { token-a: ta, token-b: tb }
            { reserve-a: reserve-x, reserve-b: reserve-y, total-fees-accrued: u0 })
          (ok true))
      err (err err))))

;; Internal: fetch reserves for a pair in canonical form
(define-private (get-reserves (token-x principal) (token-y principal))
  (match (canonical-pair token-x token-y)
    canon
      (let ((ta (get token-a canon)) (tb (get token-b canon)))
        (match (map-get? supported-pair { token-a: ta, token-b: tb })
          entry (ok entry)
          none (err ERR-UNSUPPORTED-PAIR)))
    err (err err)))

;; Quote output amount given input using constant product formula and fee deduction
(define-private (quote-output (amount-in uint) (reserve-in uint) (reserve-out uint) (fee-bps uint))
  (if (or (<= amount-in u0) (<= reserve-in u0) (<= reserve-out u0))
      (err ERR-INSUFFICIENT-LIQUIDITY)
      (let (
            ;; Apply fee: amount_after_fee = amount_in * (10000 - fee_bps) / 10000
            (amount-after-fee (/ (* amount-in (- u10000 fee-bps)) u10000))
            (numerator (* amount-after-fee reserve-out))
            (denominator (+ reserve-in amount-after-fee)))
        (ok (/ numerator denominator)))))

;; Main swap entry: token-in -> token-out with slippage protection
(define-public (swap (token-in principal) (token-out principal) (amount-in uint) (min-amount-out uint))
  (begin
    (asserts! (not (var-get paused)) (err ERR-PAUSED))
    (asserts! (>= amount-in u1) (err ERR-ZERO-AMOUNT))
    (match (get-reserves token-in token-out)
      pair
        (let (
              (ta (get token-a (match (canonical-pair token-in token-out) c c (err ERR-UNSUPPORTED-PAIR))))
              (tb (get token-b (match (canonical-pair token-in token-out) c c (err ERR-UNSUPPORTED-PAIR))))
              (reserve-a (get reserve-a pair))
              (reserve-b (get reserve-b pair))
              ;; Determine fee: if caller is admin, get their fee, else default
              (fee-info
                (match (map-get? admin-info { key: tx-sender })
                  (some info) info
                  none { fee-bps: DEFAULT-FEE-BPS }))
              (fee-bps (get fee-bps fee-info))
              (is-reversed (not (is-eq token-in ta)))
              (reserve-in (if is-reversed reserve-b reserve-a))
              (reserve-out (if is-reversed reserve-a reserve-b)))
          (match (quote-output amount-in reserve-in reserve-out fee-bps)
            (ok amount-out)
              (begin
                (asserts! (>= amount-out min-amount-out) (err ERR-SLIPPAGE-EXCEEDED))
                ;; Calculate fee collected: input - effective amount used before curve
                (let (
                      (amount-after-fee (/ (* amount-in (- u10000 fee-bps)) u10000))
                      (fee-collected (- amount-in (/ (* amount-after-fee u10000) (- u10000 fee-bps))))
                      (new-reserve-in (+ reserve-in amount-in))
                      (new-reserve-out (- reserve-out amount-out))
                      (pair-key { token-a: ta, token-b: tb }))
                  ;; Build updated reserves depending on direction
                  (let ((updated-reserves
                          (if is-reversed
                              { reserve-a: new-reserve-out
                              , reserve-b: new-reserve-in
                              , total-fees-accrued: (+ (get total-fees-accrued pair) (if (<= fee-collected u0) u0 fee-collected)) }
                              { reserve-a: new-reserve-in
                              , reserve-b: new-reserve-out
                              , total-fees-accrued: (+ (get total-fees-accrued pair) (if (<= fee-collected u0) u0 fee-collected)) })))
                    (map-set supported-pair pair-key updated-reserves)
                    (ok { amount-out: amount-out, fee: (if (<= fee-collected u0) u0 fee-collected) })))))
            err (err err)))
      err (err err)))
