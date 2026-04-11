# Ideas — Ingombro

---

## 1. Browser & app cache cleanup

Aggiungere una tab "System Clean" che rileva cache di browser (`~/Library/Caches/com.apple.Safari`, Chrome, Firefox), cache di app (Spotify, Slack, Discord, Xcode DerivedData) e log di sistema. Visualizzare il tutto nel treemap — differenziatore forte rispetto all'output CLI di Mole.

## 2. Duplicate file finder

Scansione per file duplicati tramite hash. Raggruppamento nel treemap con azione "Deduplica". Né Mole né Ingombro lo fanno attualmente.

## 3. Large file spotlight

Vista dedicata che mostra i top N file più grandi nell'intero albero scansionato, indipendentemente dalla profondità. Recupero rapido di spazio che il treemap da solo può nascondere quando i file sono sepolti in profondità.

## 4. Dry-run / preview mode

Prima di ogni batch delete in Smart Clean, mostrare un'anteprima dettagliata con dimensione totale, breakdown per rischio e un riepilogo "what if". Equivalente visivo del `--dry-run` di Mole, con schermata di conferma che mostra treemap prima/dopo.

## 5. Whitelist / esclusioni

Permettere agli utenti di fissare path che non devono mai apparire nei suggerimenti di Smart Clean. Persistere in `settings.json`. Costruisce fiducia nell'utente.

## 6. Stale project detection

Segnalare progetti non modificati da X mesi che hanno ancora `node_modules`/`target`/`.venv` pesanti. Ordinare per "ultima modifica + dimensione" per evidenziare i guadagni maggiori. Codifica colore nel treemap per visualizzare la "staleness".

## 7. Scheduled / recurring scans

Modalità "watch" o sistema di promemoria che ri-scansiona periodicamente le directory in cache e notifica quando lo spazio recuperabile supera una soglia.

## 8. Xcode DerivedData cleanup

`~/Library/Developer/Xcode/DerivedData` è un noto divoratore di spazio su macOS. Aggiungerlo come categoria Smart Clean di prima classe — attualmente mancante dalle regole.

## 9. Download folder cleanup

Rilevare vecchi `.dmg`, `.pkg`, `.zip` installer in `~/Downloads` più vecchi di N giorni. Raggruppamento visivo per tipo di file con eliminazione batch.

## 10. Space-over-time chart

Tracciare lo spazio liberato tra le sessioni e mostrare un piccolo grafico storico nella home screen. `totalFreedBytes` esiste già per sessione — persistendolo si ottiene un soddisfacente "hai liberato 47 GB questo mese".
