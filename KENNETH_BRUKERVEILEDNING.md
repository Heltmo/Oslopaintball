# Oslo Paintball – enkel brukerveiledning

Kort guide for å bruke bookingløsningen og adminpanelet.

## Lenker

- Offentlig nettside: https://oslopaintball.netlify.app/
- Booking: https://oslopaintball.netlify.app/booking
- Adminpanel: https://oslopaintball.netlify.app/admin

## Logg inn i admin

1. Gå til: https://oslopaintball.netlify.app/admin
2. Logg inn med brukernavn og passord du har fått.
3. Ikke del admin-passordet offentlig.

Midlertidig brukernavn er `Oslopaintball`. Midlertidig passord skal byttes før overtakelse og lansering.

## Hva skjer når en kunde booker?

1. Kunden fyller ut booking-skjemaet.
2. Bookingen lagres automatisk i systemet.
3. Bookingen dukker opp i adminpanelet som en ny forespørsel.
4. Status starter normalt som `Venter`.

Merk: Bookingforespørselen er ikke endelig bekreftet før dere har sjekket dato/tid og bekreftet manuelt.

## Følge opp en booking

I adminpanelet kan du:

- se kundeinfo
- se dato, tid, pakke og gruppestørrelse
- lese kundens melding
- skrive interne admin-notater
- ringe kunden
- sende e-post
- endre status
- slette booking

## Statusforklaring

- **Venter**: Ny forespørsel som ikke er behandlet ennå.
- **Bekreftet**: Dere har bekreftet bookingen med kunden.
- **Avlyst**: Bookingen er avlyst.
- **Fullført**: Arrangementet er gjennomført.

## Anbefalt arbeidsflyt

1. Åpne adminpanelet.
2. Se nye bookinger under `Venter`.
3. Ring eller send e-post til kunden for å bekrefte detaljer.
4. Hvis bookingen passer: sett status til `Bekreftet`.
5. Hvis kunden avbestiller eller tidspunktet ikke passer: sett status til `Avlyst`.
6. Etter arrangementet: sett status til `Fullført`.
7. Bruk admin-notater til ting kunden ikke skal se, f.eks. “ringt 12:30”, “ønsker faktura”, “må ha ekstra instruktør”.

## Slette testbookinger eller feilregistreringer

1. Åpne bookingen i adminpanelet.
2. Trykk **Slett booking**.
3. Bekreft i dialogen.
4. Sjekk at bookingen forsvinner fra listen.

Bruk sletting primært for testbookinger, duplikater eller åpenbare feil. For ekte kundehenvendelser er det ofte bedre å sette status til `Avlyst`, slik at historikken beholdes.

## Før lansering

Sjekk dette før siden vises til kunde eller brukes live:

- [ ] Testbookinger er slettet.
- [ ] Admin-passord er sterkt og delt trygt.
- [ ] Booking-skjemaet fungerer.
- [ ] Adminpanelet viser nye bookinger.
- [ ] Statusendring fungerer.
- [ ] E-postvarsling til `booking@oslopaintball.no` er aktivert.
- [ ] SMS-varsling er deaktivert foreløpig.

## E-post og SMS

Systemet kan sende e-post og SMS, men dette må kobles opp separat. For nå skal bookingvarsler gå til `booking@oslopaintball.no`, og SMS-varsler er deaktivert foreløpig.

E-post krever Resend-oppsett:

- `RESEND_API_KEY`
- `BOOKING_FROM_EMAIL`
- `BOOKING_REPLY_TO_EMAIL`
- `ADMIN_NOTIFY_EMAIL`

SMS krever Twilio-oppsett:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM_NUMBER`
- `ADMIN_NOTIFY_PHONE`

Så lenge Twilio-variablene er tomme, sendes ingen SMS-varsler.
