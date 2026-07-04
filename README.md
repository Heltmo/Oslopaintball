# Oslo Paintball V1

Lettvekts bookingløsning for Oslo Paintball med offentlig nettside, bookingforespørsler, Supabase-lagring, passordbeskyttet adminoversikt og valgfri e-post/SMS-varsling.

## Hva løsningen gjør

- Forside med aktiviteter, anmeldelser, FAQ og galleri
- Bookingflyt for pakke, gruppestørrelse, dato, tid, tillegg og kontaktinfo
- Server-side validering av bookingdata
- Supabase i produksjon og lokal SQLite fallback for utvikling
- Adminoversikt med status, filtrering og interne notater
- E-post via Resend når miljøvariabler er satt
- SMS via Twilio når miljøvariabler er satt

## Viktig scope

Dette er et reservasjons-/forespørselssystem, ikke full checkout.

- Ingen online betaling
- Betaling skjer på stedet
- Slot-kapasitet gjelder bekreftede bookinger per dato/tid
- Hverdager kan sendes inn som forespørsel etter avtale
- E-post/SMS sendes best effort etter at booking er lagret. En varslingsfeil skal ikke slette eller blokkere en lagret booking.

## Lokal oppstart

Krever Node 24 eller nyere, fordi lokal SQLite fallback bruker `node:sqlite`.

```bash
npm start
```

Serveren starter på `http://localhost:3000`.

- Forside: `http://localhost:3000/`
- Booking: `http://localhost:3000/booking`
- Admin: `http://localhost:3000/admin`

Sett `ADMIN_USERNAME` og `ADMIN_PASSWORD` i miljøet før lokal testing og produksjon. Serveren feiler lukket hvis disse mangler.

## Kvalitetssjekk

```bash
npm run check
```

Denne sjekker JavaScript-syntaksen i lokal server, frontend, admin og Netlify Functions.

## Supabase-oppsett

1. Lag et Supabase-prosjekt for kunden.
2. Åpne SQL Editor i Supabase.
3. Kjør innholdet i `supabase/schema.sql`.
4. Hent `Project URL` og `service_role` key fra Supabase settings.
5. Legg verdiene i Netlify environment variables.

Miljøvariabler for database/admin:

```env
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
ADMIN_USERNAME=Oslopaintball
ADMIN_PASSWORD=
PUBLIC_SITE_URL=https://oslopaintball.netlify.app
BOOKING_BUSINESS_NAME=Oslo Paintball
BOOKING_LOCATION=Oslo Paintball, Stuaveien, 1480 Slattum
BOOKING_EVENT_DURATION_MINUTES=120
BOOKING_SLOT_CAPACITY=2
BOOKING_EXTRA_OPEN_DATES=
```

`SUPABASE_SERVICE_ROLE_KEY` skal kun ligge server-side i Netlify/local env. Den skal aldri inn i frontend.

For Netlify-test kan `PUBLIC_SITE_URL` peke til `https://oslopaintball.netlify.app`. Når domenet pekes om, settes den til `https://oslopaintball.no`. Midlertidig passord skal byttes før overtakelse og lansering.

## E-postvarsling

Løsningen bruker Resend via HTTP API hvis disse miljøvariablene finnes:

```env
RESEND_API_KEY=re_xxx
BOOKING_FROM_EMAIL=Oslo Paintball <booking@oslopaintball.no>
BOOKING_REPLY_TO_EMAIL=booking@oslopaintball.no
ADMIN_NOTIFY_EMAIL=booking@oslopaintball.no
```

Når e-post er konfigurert:

- Kunden får e-post når bookingforespørselen er mottatt.
- Admin får e-post ved ny bookingforespørsel.
- Kunden får ny e-post når admin setter status til `confirmed`.
- Bekreftelsesmailen inneholder en enkel Google Kalender-lenke når dato og tid er satt.

Avsenderadressen må være verifisert hos e-postleverandøren før produksjon.

## SMS-varsling

Løsningen bruker Twilio via HTTP API hvis disse miljøvariablene finnes:

```env
TWILIO_ACCOUNT_SID=ACxxx
TWILIO_AUTH_TOKEN=xxx
TWILIO_FROM_NUMBER=+47xxxxxxxx
ADMIN_NOTIFY_PHONE=+47xxxxxxxx
```

SMS-varsler er deaktivert så lenge Twilio-variablene står tomme.

Når SMS er konfigurert:

- Kunden får SMS når bookingforespørselen er mottatt.
- Admin får SMS ved ny bookingforespørsel hvis `ADMIN_NOTIFY_PHONE` er satt.
- Kunden får ny SMS når admin setter status til `confirmed`.

Telefonnummer fra skjemaet normaliseres til norsk `+47` når kunden skriver 8 siffer.

## Netlify

Netlify bruker `netlify/functions/api.js` for API-et og `netlify/functions/admin.js` for admin-HTML. `netlify.toml` ruter `/api/*`, `/booking` og `/admin`.

Publisering:

1. Koble repoet til Netlify.
2. Build command: tom eller `echo "No build"`.
3. Publish directory: `.`.
4. Functions directory: `netlify/functions`.
5. Legg inn miljøvariablene over.
6. Redeploy etter miljøvariabler er lagt inn.

Etter deploy:

- Forside: `https://din-netlify-url.netlify.app/`
- Booking: `https://din-netlify-url.netlify.app/booking`
- Admin: `https://din-netlify-url.netlify.app/admin`

Ikke del `/admin.html`. Bruk `/admin`, slik at Netlify Function håndterer innloggingen.

## Bookingdata

Bookinger lagres i tabellen `bookings` med disse feltene:

- `id`
- `name`
- `phone`
- `email`
- `package`
- `group_size`
- `preferred_date`
- `preferred_time`
- `extras`
- `notes`
- `admin_notes`
- `privacy_consent`
- `privacy_consent_at`
- `status`
- `created_at`

Gyldige statuser:

- `pending`
- `confirmed`
- `cancelled`
- `completed`

## Adminflyt

1. Ny booking lagres som `pending`.
2. Admin åpner bookingen i `/admin`.
3. Admin kan lagre interne notater.
4. Admin setter booking til `confirmed`, `cancelled` eller `completed`.
5. Når status settes til `confirmed`, sendes bekreftelse til kunden hvis e-post/SMS er konfigurert.

## Lokal database

Når Supabase ikke er konfigurert, bruker lokal server `data/bookings.db`. Testbookinger legges inn gjennom vanlig bookingskjema og slettes fra adminpanelet.
