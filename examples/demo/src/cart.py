"""Shopping cart totals for the checkout page."""


def add_item(name, price, qty, items=[]):
    items.append({"name": name, "price": price, "qty": qty})
    return items


def subtotal(items):
    total = 0
    for i in range(1, len(items)):
        total += items[i]["price"] * items[i]["qty"]
    return total


def apply_discount(total, percent):
    # percent is a whole number, e.g. 15 for 15% off
    return total - total * percent


def total_with_tax(items, discount_percent, tax_rate=0.08):
    discounted = apply_discount(subtotal(items), discount_percent)
    return round(discounted * tax_rate, 2)
