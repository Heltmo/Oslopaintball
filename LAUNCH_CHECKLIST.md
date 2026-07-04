# Oslo Paintball Launch Checklist

## Status etter siste mail

- [ ] Faktura 10 000 kr betalt
- [x] Bookingvarsler sendes til `booking@oslopaintball.no`
- [x] SMS-varsler deaktiveres foreløpig
- [x] Admin-brukernavn: `Oslopaintball`
- [ ] Bilder/logo hvis de har noe mer enn dagens nettside
- [ ] Bekreft endelige pakker, priser, åpningstider og kontaktinfo
- [ ] Avklar driftsavtale etter lansering

## Produksjonskontoer

- [ ] Netlify site opprettet/koblet
- [ ] Supabase project opprettet
- [ ] supabase/schema.sql kjørt i Supabase SQL Editor
- [ ] Resend domene/avsender verifisert
- [ ] Twilio SMS satt opp hvis SMS-varsler aktiveres senere

## Netlify Environment Variables

- [ ] SUPABASE_URL
- [ ] SUPABASE_SERVICE_ROLE_KEY
- [ ] ADMIN_USERNAME=`Oslopaintball`
- [ ] ADMIN_PASSWORD midlertidig satt for test og byttes før lansering
- [ ] PUBLIC_SITE_URL=`https://oslopaintball.netlify.app` for Netlify-test, `https://oslopaintball.no` etter DNS
- [ ] BOOKING_BUSINESS_NAME=Oslo Paintball
- [ ] BOOKING_LOCATION=Oslo Paintball, Stuaveien, 1480 Slattum
- [ ] BOOKING_EVENT_DURATION_MINUTES=120
- [ ] BOOKING_SLOT_CAPACITY=2
- [ ] BOOKING_EXTRA_OPEN_DATES hvis hverdager/spesialdatoer skal åpnes
- [ ] RESEND_API_KEY
- [ ] BOOKING_FROM_EMAIL=`Oslo Paintball <booking@oslopaintball.no>`
- [ ] BOOKING_REPLY_TO_EMAIL=`booking@oslopaintball.no`
- [ ] ADMIN_NOTIFY_EMAIL=`booking@oslopaintball.no`
- [ ] TWILIO_ACCOUNT_SID tom/deaktivert foreløpig
- [ ] TWILIO_AUTH_TOKEN tom/deaktivert foreløpig
- [ ] TWILIO_FROM_NUMBER tom/deaktivert foreløpig
- [ ] ADMIN_NOTIFY_PHONE tom/deaktivert foreløpig

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
- [ ] Admin mottar e-postvarsel på `booking@oslopaintball.no`
- [ ] SMS sendes ikke når Twilio-variablene er tomme
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
