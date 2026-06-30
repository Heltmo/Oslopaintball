# Oslo Paintball Launch Checklist

## Venter på Kenneth

- [ ] Faktura 10 000 kr betalt
- [ ] E-postadresse som skal motta bookingvarsler
- [ ] Telefonnummer som skal motta SMS-varsler
- [ ] Ønsket admin-brukernavn
- [ ] Bilder/logo hvis de har noe mer enn dagens nettside
- [ ] Bekreft endelige pakker, priser, åpningstider og kontaktinfo
- [ ] Avklar driftsavtale etter lansering

## Produksjonskontoer

- [ ] Netlify site opprettet/koblet
- [ ] Supabase project opprettet
- [ ] supabase/schema.sql kjørt i Supabase SQL Editor
- [ ] Resend domene/avsender verifisert
- [ ] Twilio SMS satt opp

## Netlify Environment Variables

- [ ] SUPABASE_URL
- [ ] SUPABASE_SERVICE_ROLE_KEY
- [ ] ADMIN_USERNAME
- [ ] ADMIN_PASSWORD
- [ ] PUBLIC_SITE_URL
- [ ] BOOKING_BUSINESS_NAME=Oslo Paintball
- [ ] BOOKING_LOCATION=Oslo Paintball, Stuaveien, 1480 Slattum
- [ ] BOOKING_EVENT_DURATION_MINUTES=120
- [ ] BOOKING_SLOT_CAPACITY=2
- [ ] BOOKING_EXTRA_OPEN_DATES hvis hverdager/spesialdatoer skal åpnes
- [ ] RESEND_API_KEY
- [ ] BOOKING_FROM_EMAIL
- [ ] BOOKING_REPLY_TO_EMAIL
- [ ] ADMIN_NOTIFY_EMAIL
- [ ] TWILIO_ACCOUNT_SID
- [ ] TWILIO_AUTH_TOKEN
- [ ] TWILIO_FROM_NUMBER
- [ ] ADMIN_NOTIFY_PHONE

## Test Før Domene Pekes Om

- [ ] Forside laster
- [ ] Booking-side laster
- [ ] Admin krever login
- [ ] Booking uten personvern-samtykke avvises
- [ ] Booking med gyldige data lagres
- [ ] Ny booking vises i admin
- [ ] Admin-notat kan lagres
- [ ] Booking kan bekreftes
- [ ] Kunde mottar bekreftelsesmail
- [ ] Kalenderlenke i bekreftelsesmail åpner riktig event
- [ ] Kunde mottar SMS
- [ ] Admin mottar varsel
- [ ] Mobilvisning sjekket

## DNS / Domene

- [ ] Netlify domain settings klare
- [ ] DNS-instruks sendt til Hjemmesidehuset
- [ ] SSL aktivt etter DNS-endring
- [ ] https://oslopaintball.no testet etter ompeking
- [ ] /admin testet etter ompeking

## Etter Lansering

- [ ] Send kort brukerveiledning til Kenneth
- [ ] Del admin-URL og innloggingsdetaljer på trygg måte
- [ ] Avtal driftsrutine og fakturering
- [ ] Noter første måned som ekstra oppfølging/testperiode
