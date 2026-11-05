Build a mobile app for **Sweet Juniper Bakehouse**, a family-run bakery with custom cakes in Riverbend, AL.

This is a real business and its owner has reviewed the facts below. The app is for their customers. Every fact in the app (names, prices, hours, phone numbers, links) must come from BUSINESS_DATA; do not invent menu items, prices, reviews, team members, awards or history. Where content is missing, follow each screen's "Content still missing" note.

## Output
- One self-contained `index.html`: inline CSS and JS, no frameworks, no external requests except Google Fonts for "Fraunces", links the user taps (tel:, sms:, mailto:, maps and the business's own tool links).
- Embed BUSINESS_DATA exactly as given in `<script type="application/json" id="business-data">` and render every screen from it, so the owner can update content later by editing that block alone.
- Mobile-first (360-430px wide), safe-area insets, 44px minimum tap targets, WCAG AA contrast, respects prefers-reduced-motion, works offline once loaded.
- No payments, accounts or collection of sensitive personal data. Forms send pre-filled SMS or email to the business, or open the business's existing tool.

## Look and feel
- Tone: warm, family-run, welcoming. Voice: Warm and chatty, signs posts 'from the Juniper kitchen', light emoji use.
- Colors: primary #3f6b4f, secondary #e8a33d, accent #e8a33d, background #fbf6ee, text #111827, text on primary #ffffff. Put them in CSS custom properties.
- Headings in "Fraunces" with a system-font fallback; body in the system font stack.
- Logo: https://sweetjuniperbakehouse.example/images/logo.png (show the business name in the heading font if it fails to load).
- Imagery: Close-up shots of bread and pastries on wooden boards, natural light.

## Navigation
- Bottom tab bar: Home, Order, Menu, Get a Quote, More.
- "More" opens a sheet listing: Hours, Specials, Reviews, About, Contact, FAQ.
- Home quick actions, in this order: Order, Get a quote, Call, Directions.

## Screens
### Home (`home`)
Hero with logo (or the business name set in the brand font), tagline, an open-now badge computed from hours, and 2-4 quick-action buttons chosen from the plan's modules (Call, Directions, Order, Book, Get a quote). Show the current special or announcement if one exists.

### Hours (`hours`)
Seven-day table with today highlighted, open/closed now computed on the device clock (handle split shifts and past-midnight closing), and the hours notes (holidays, seasonal changes).

### Menu (`menu`)
Category tabs or chips, item cards with name, description and price, dietary/specialty tag filters, and a search box when there are more than 25 items. Prices shown exactly as given; never invent one.

### Order (`online_ordering`)
One clear Order Online button to the existing provider plus delivery-platform buttons.
Mode: deep link. The business already uses Square Online; the main action opens https://sweetjuniperbakehouse.square.site. Do not rebuild that system.

### Specials (`specials`)
A list of specials/announcements with optional date ranges; expired ones hide automatically. Seed it from research only if specials were found, otherwise show an owner placeholder.
Content still missing: current specials (optional). Render a tidy "coming soon" state for customers, and mark the spot with data-owner-todo="specials".

### Get a Quote (`quote_request`)
Form with service type (from services), description, address or town, preferred contact method and optional photos; submits as a pre-filled email (photos attached by the customer) or SMS. Deep-link mode if they already use a quote form provider.

### Reviews (`reviews_showcase`)
Show the rating and review count with its source, Leave a Review buttons for each review platform found, and a testimonials list that only shows quotes the owner supplies. Never write or paraphrase reviews as testimonials.

### About (`about`)
Short story from business.description, a list of differentiators, and the founding year if known. No invented history.

### Contact (`contact`)
tel:, sms: and mailto: buttons for whatever contact info exists, the address with a Directions button (Google Maps link built from the address; skip it when address_is_public is false) and icons for each social profile.

### FAQ (`faq`)
Accordion of questions and answers. Seed only with questions whose answers came from research (for example payment methods, parking, allergy policy); everything else is an owner placeholder.
Content still missing: common questions and answers. Render a tidy "coming soon" state for customers, and mark the spot with data-owner-todo="faq".

## BUSINESS_DATA
```json
{
  "name": "Sweet Juniper Bakehouse",
  "tagline": "Small-batch breads and pastries, baked fresh every morning",
  "description": "A family-run bakery selling sourdough, cinnamon rolls, seasonal pies and custom celebration cakes. Customers pick up at the storefront or order cakes ahead for birthdays and weddings.",
  "industry": "cafe_bakery",
  "year_founded": "2019",
  "contact": {
    "phone": "(256) 555-0142",
    "email": "hello@sweetjuniperbakehouse.example",
    "website": "https://sweetjuniperbakehouse.example",
    "address": {
      "street": "214 Main St",
      "city": "Riverbend",
      "region": "AL",
      "postal_code": "35000",
      "country": "US"
    },
    "address_is_public": true,
    "service_area": [],
    "maps_url": "https://maps.google.com/?cid=1234567890"
  },
  "hours": {
    "known": true,
    "weekly": [
      {
        "day": "tue",
        "open": "07:00",
        "close": "14:00"
      },
      {
        "day": "wed",
        "open": "07:00",
        "close": "14:00"
      },
      {
        "day": "thu",
        "open": "07:00",
        "close": "14:00"
      },
      {
        "day": "fri",
        "open": "07:00",
        "close": "14:00"
      },
      {
        "day": "sat",
        "open": "08:00",
        "close": "13:00"
      }
    ],
    "notes": "Closed Sunday and Monday. Holiday pie orders close a week before Thanksgiving."
  },
  "offerings": {
    "kind": "menu",
    "categories": [
      {
        "name": "Breads",
        "items": [
          {
            "name": "Country Sourdough",
            "description": "Two-day ferment, crackly crust",
            "price": "$9"
          },
          {
            "name": "Honey Oat Sandwich Loaf",
            "description": "",
            "price": "$7"
          }
        ]
      },
      {
        "name": "Pastries",
        "items": [
          {
            "name": "Cinnamon Roll",
            "description": "Cream cheese frosting",
            "price": "$4.50"
          },
          {
            "name": "Seasonal Hand Pie",
            "description": "Flavor changes weekly",
            "price": "$5"
          }
        ]
      },
      {
        "name": "Custom Cakes",
        "items": [
          {
            "name": "Celebration Cake (6 inch)",
            "description": "Order 5 days ahead",
            "price": "From $45"
          },
          {
            "name": "Wedding Cakes",
            "description": "Consultation required",
            "price": ""
          }
        ]
      }
    ],
    "tags": [
      "made from scratch",
      "gluten-free option on Saturdays"
    ]
  },
  "differentiators": [
    "Two-day sourdough",
    "Custom celebration and wedding cakes",
    "Family-run since 2019"
  ],
  "existing_tools": [
    {
      "type": "online_ordering",
      "provider": "Square Online",
      "url": "https://sweetjuniperbakehouse.square.site"
    }
  ],
  "socials": [
    {
      "platform": "facebook",
      "url": "https://www.facebook.com/sweetjuniperbakehouse",
      "handle": "sweetjuniperbakehouse"
    },
    {
      "platform": "instagram",
      "url": "https://www.instagram.com/sweetjuniperbakes",
      "handle": "sweetjuniperbakes"
    }
  ],
  "reviews": {
    "rating": 4.8,
    "count": 212,
    "source": "Google"
  },
  "brand": {
    "logo_url": "https://sweetjuniperbakehouse.example/images/logo.png",
    "fonts": [
      "Fraunces"
    ],
    "tone": "warm_family"
  },
  "specials": [],
  "faq": [],
  "team": [],
  "gallery": [],
  "events": [],
  "modules": [
    {
      "id": "home",
      "mode": "native",
      "tool_url": ""
    },
    {
      "id": "hours",
      "mode": "native",
      "tool_url": ""
    },
    {
      "id": "menu",
      "mode": "native",
      "tool_url": ""
    },
    {
      "id": "online_ordering",
      "mode": "deep_link",
      "tool_url": "https://sweetjuniperbakehouse.square.site"
    },
    {
      "id": "specials",
      "mode": "native",
      "tool_url": ""
    },
    {
      "id": "quote_request",
      "mode": "native",
      "tool_url": ""
    },
    {
      "id": "reviews_showcase",
      "mode": "native",
      "tool_url": ""
    },
    {
      "id": "about",
      "mode": "native",
      "tool_url": ""
    },
    {
      "id": "contact",
      "mode": "native",
      "tool_url": ""
    },
    {
      "id": "faq",
      "mode": "native",
      "tool_url": ""
    }
  ]
}
```
