flowchart down
title: Order flow
group Checkout {
  Cart -> Payment
}
group Fulfilment {
  Pick -> Ship
}
Payment -> Pick
