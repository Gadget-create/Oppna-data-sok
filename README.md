# Sök öppna samhällsbyggnadsdata (prototyp)

Enkel statisk söksida för att se vilken öppen samhällsbyggnadsdata som finns, på vilken geografisk nivå, och vad datat avser. Sidan hämtar bara metadata, inte statistikvärden.

## Öppna prototypen

Det enklaste är att öppna filen i webbläsaren:

`/workspace/oppna-data-sok/index.html`

eller, om du vill köra en lokal webbserver från mappen:

```bash
cd /workspace/oppna-data-sok
python3 -m http.server 8765
```

Öppna därefter http://127.0.0.1:8765/

SCB och Kolada tillåter anrop från webbläsaren (CORS `*`). Sveriges dataportal speglar `Origin` och brukar fungera både via `file://` och lokal server.

## Vad du kan göra

- Söka på fritext och samtidigt välja ett tema (båda används tillsammans).
- Filtrera på källa och geografisk nivå.
- Välja ett område, till exempel Gävle kommun, för att se om datat finns där.
- Läsa beskrivning, mått, variabler, tidsperiod, uppdatering, geografisk nivå och källa för varje träff.
- Följa länk till källan, till metadata-API och till data-API för export till ett analysverktyg (själva värdena hämtas inte av prototypen).

## Test utan webbläsare

```bash
python3 /workspace/oppna-data-sok/test_sok.py
```

## Källor

- SCB Statistikdatabasen, API v2: `https://statistikdatabasen.scb.se/api/v2/tables`
- Kolada API v3: `https://api.kolada.se/v3/kpi` (v2 är avvecklad)
- Sveriges dataportal: `https://admin.dataportal.se/store/search`
