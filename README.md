# Oslo Paintball V1

Lettvekts reservasjonsløsning for Oslo Paintball.

## Innhold

- Offentlig side med:
  - hero
  - pakker/priser
  - praktisk info
  - FAQ
  - bookingflyt
- Backend for bookinglagring i Supabase eller lokal SQLite fallback
- Enkel admin-oversikt for innkommende bookinger

## Filer

```text
oslopaintball/
├── index.html
├── styles.css
├── script.js
├── server.js
├── admin.html
├── admin.css
├── admin.js
├── package.json
├── netlify.toml
├── netlify/
│   └── functions/
│       ├── admin.js
│       └── api.js
├── supabase/
│   └── schema.sql
└── images/
```

## Kjør lokalt

```bash
npm start
```

Serveren starter på `http://localhost:3000`.

Admin ligger på `http://localhost:3000/admin`.

Standard lokal admin-login:

- Brukernavn: `admin`
- Passord: `paintball2026`

Sett `ADMIN_USERNAME` og `ADMIN_PASSWORD` i miljøet før produksjon. Produksjon feiler lukket hvis disse mangler.

## Demo for kundevisning

Når Supabase ikke er konfigurert, kjører prosjektet lokalt med SQLite og demo-modus aktivert.

For å vise arbeidsflyten:

1. Start serveren med `npm start`.
2. Åpne `http://localhost:3000/admin`.
3. Logg inn med lokal admin-login.
4. Trykk `Last demo-data`.
5. Åpne en booking, endre status og lagre internt notat.

Demo-knappen sletter bare tidligere demo-bookinger med e-post på `@demo.oslopaintball.no` og legger inn nye realistiske testbookinger. Den rører ikke ekte bookinger.

Sett `DEMO_MODE=0` for å skjule demo-seed på lokal server. Når Supabase er konfigurert, er demo-seed automatisk deaktivert.

## Supabase

Produksjon og Netlify-demo bruker Supabase. Lokal utvikling kan fortsatt bruke SQLite fallback.

1. Lag et Supabase-prosjekt.
2. Åpne SQL Editor i Supabase.
3. Kjør innholdet i `supabase/schema.sql`.
4. Sett miljøvariabler på serveren:

```env
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
ADMIN_USERNAME=admin
ADMIN_PASSWORD=et-sterkt-passord
```

Når `SUPABASE_URL` og `SUPABASE_SERVICE_ROLE_KEY` finnes, bruker `server.js` Supabase automatisk. Uten disse bruker den `data/bookings.db` lokalt.

`SUPABASE_SERVICE_ROLE_KEY` skal bare ligge på serveren, aldri i frontend eller offentlig repo.

## Netlify

Netlify kan ikke kjøre `server.js` som en vanlig server. Derfor ligger API-et for Netlify i `netlify/functions/api.js`, og `netlify.toml` sender `/api/*` dit. Adminsiden beskyttes av `netlify/functions/admin.js`.

Publisering på Netlify:

1. Legg prosjektet på GitHub.
2. Opprett nytt Netlify-site fra GitHub-repoet.
3. Bruk standard build settings:
   - Build command: tom eller `echo "No build"`
   - Publish directory: `.`
   - Functions directory: `netlify/functions`
4. Legg inn environment variables i Netlify:

```env
ADMIN_USERNAME=admin
ADMIN_PASSWORD=et-sterkt-demo-passord
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
DEMO_MODE=1
```

Etter deploy:

- Forside: `https://din-netlify-url.netlify.app/`
- Booking: `https://din-netlify-url.netlify.app/booking`
- Admin: `https://din-netlify-url.netlify.app/admin`

Demo-data kan seedes via API-et når `DEMO_MODE=1`. Sett `DEMO_MODE=0` eller fjern variabelen før kundelevering.

Ikke bruk `/admin.html` som kundelenke. Bruk alltid `/admin`, slik at Netlify Function håndterer innloggingen.

## Bookingdata

Bookinger lagres i Supabase-tabellen `bookings`, eller lokalt i `data/bookings.db` når Supabase ikke er konfigurert. Feltene er:

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
- `status`
- `created_at`

Gyldige statuser:

- `pending`
- `confirmed`
- `cancelled`
- `completed`

## Adminflyt

1. Ny booking kommer inn som `pending`.
2. Admin åpner bookingen, sjekker kundedetaljer og eventuelle notater.
3. Admin kan lagre interne notater i `admin_notes`.
4. Admin bekrefter, avlyser eller markerer bookingen som fullført.

Når en booking settes til `confirmed`, blokkerer serveren andre bekreftede bookinger på samme dato og tidspunkt. Nye bookingforespørsler blir også avvist hvis tidspunktet allerede er bekreftet.

## Viktig

- Ingen online betaling
- Ingen live availability engine
- Enkel slot-konflikt for bekreftede bookinger
- Betaling skjer på stedet
