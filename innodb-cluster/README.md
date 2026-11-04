# InnoDB Cluster — laboratorio Docker Compose

Configurazione didattica per **tre nodi InnoDB Cluster + MySQL Router + dbwebapp**,
derivata dall'esempio storico di `neumayer/mysql-docker-compose-examples`.

> **Solo laboratorio locale, non produzione.** Password dimostrative e MySQL 8.0.32
> sono mantenuti per ridurre le incompatibilita' con l'app del tutorial.
> Per una nuova architettura di produzione scegliere MySQL 8.4 LTS o successivo,
> con Shell, Router e applicazione aggiornati insieme.

## Cosa risolve

Nell'esempio originale, dopo `docker stop` + `docker start`, MySQL ripartiva
ma **Group Replication non rientrava** nel gruppo, con errore:

```text
[MY-011685] The group name option is mandatory
[MY-011660] Unable to start Group Replication on boot
```

La vecchia immagine `neumayer/mysql-shell-batch` installava MySQL Shell
**1.0.11** e il suo entrypoint mascherava gli errori con `|| true`.

Questa versione:

- usa MySQL Server/Shell 8.0.32 e Router 8.0.32;
- salva esplicitamente i valori reali di Group Replication con `SET PERSIST_ONLY`;
- verifica che le impostazioni chiave siano persistite;
- usa hostname stabili, `report-host` e volumi nominati;
- attende i tre server prima del bootstrap; Router parte dopo il bootstrap riuscito;
- non tenta di creare nuovamente un cluster se trova metadata gia' presenti;
- non nasconde gli errori di bootstrap; imposta `stop_grace_period: 60s`;
- espone le porte dell'host solo su `127.0.0.1`.

## Primo avvio

Dalla directory `innodb-cluster`:

```powershell
docker compose up -d
docker compose logs -f mysql-shell mysql-router
```

Lo script `mysql-shell` deve terminare con successo (**Exited (0)**) e stampare:
`Cluster pronto: 3 ONLINE; parametri Group Replication persistiti.`

Se fallisce, leggere `docker compose logs mysql-shell`. Router non deve
essere considerato operativo fino al completamento del bootstrap.

Verifica iniziale:

```powershell
docker compose exec mysql-server-1 mysql -uroot -pmysql -e "SELECT MEMBER_HOST, MEMBER_STATE, MEMBER_ROLE FROM performance_schema.replication_group_members"
```

Controllo persistenza su un nodo:

```powershell
docker compose exec mysql-server-2 mysql -uroot -pmysql -e "SELECT VARIABLE_NAME, VARIABLE_VALUE FROM performance_schema.persisted_variables WHERE VARIABLE_NAME LIKE 'group_replication_%'"
```

Porte locali: `3301`, `3302`, `3303` (server), `6446` (Router RW),
`6447` (Router RO), `8080` (applicazione).

## Prova stop / start (per gli studenti)

```powershell
docker compose stop mysql-server-2
# Attendere la rimozione del nodo 2 dalla membership effettiva.
docker compose start mysql-server-2
# NON fermare ancora il nodo 3!
docker compose exec mysql-server-1 mysql -uroot -pmysql -e "SELECT MEMBER_HOST, MEMBER_STATE, MEMBER_ROLE FROM performance_schema.replication_group_members"
# Attendere che TUTTI E TRE siano ONLINE.
docker compose stop mysql-server-3
# Verificare che 1 + 2 mantengano il quorum.
docker compose start mysql-server-3
```

La regola didattica fondamentale: **container avviato != membro ONLINE**.
Il quorum di 3 nodi richiede almeno 2 membri comunicanti, non solo 2
container con processo `mysqld` in esecuzione.

## Pulizia completa

Solo per un laboratorio senza dati da conservare:

```powershell
docker compose down -v
docker compose up -d
```

**ATTENZIONE: `down -v` elimina tutti i dati nei volumi del laboratorio.**
Non riutilizzare volumi creati con MySQL 8.0.12 cambiando semplicemente il tag
dell'immagine: per questa esercitazione ricreare un ambiente sacrificabile,
oppure pianificare separatamente un upgrade.

## Limiti intenzionali

- Il riavvio di **tutti e tre** i membri e' un *complete outage*: potrebbe
  richiedere `dba.rebootClusterFromCompleteOutage()`, dopo verifica GTID.
  Lo script non forza una nuova membership o un bootstrap potenzialmente pericoloso.
- Non impostare mai `group_replication_bootstrap_group=ON` in modo persistente.
- `restart: unless-stopped` non impedisce `docker compose stop` intenzionali;
  la ripresa di Group Replication e' gestita da MySQL.
- Il container one-shot `mysql-shell` non e' un controller HA che ripara il cluster:
  esegue solo inizializzazione e verifica all'avvio dell'esercitazione.
- La nuova configurazione e' stata sottoposta a verifiche statiche; eseguire
  il test completo con Docker Desktop prima di distribuirla agli studenti.

### Nota su MySQL Shell 8.0.32

Il container usa `mysqlsh --no-defaults`: a partire da 8.0.32 MySQL Shell legge
automaticamente le sezioni `[client]` dei file MySQL e, senza questo flag,
puo' tentare una connessione tramite socket locale invece che al server Docker.
Il warning `Cannot set LC_ALL to locale en_US.UTF-8` e' separato dal problema
socket e non dimostra da solo un fallimento di connessione.
