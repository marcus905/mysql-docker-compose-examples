# MySQL InnoDB Cluster con Docker Compose

Questa configurazione avvia un **InnoDB Cluster a tre nodi** in modalità
*single-primary*, con **MySQL Router** e una piccola applicazione web di esempio.
È pensata per eseguire prove locali di replica, failover e rientro dei nodi.

> **Ambiente di test, non di produzione.** Le credenziali sono dimostrative,
> i servizi espongono porte sull'interfaccia locale e le immagini sono fissate
> alla serie MySQL 8.0.32 per compatibilità con l'applicazione di esempio.
> Per nuovi sistemi in produzione, valutare MySQL 8.4 LTS o una versione
> supportata e aggiornare insieme Server, Shell e Router.

## Requisiti

- Docker con il plugin Docker Compose (`docker compose`).
- Porte locali `3301`, `3302`, `3303`, `6446`, `6447` e `8080` disponibili.

Esegui i comandi seguenti dalla directory `innodb-cluster/`.

## Avvio

```powershell
docker compose up -d
docker compose logs -f mysql-shell mysql-router
```

Al primo avvio, lo script di bootstrap crea il cluster sul nodo 1, aggiunge
i nodi 2 e 3 e salva su ciascuno le impostazioni di Group Replication
necessarie per i successivi riavvii. Il servizio `mysql-shell` è *one-shot*:
al termine deve uscire con codice `0` e riportare:

```text
Cluster pronto: 3 ONLINE; parametri Group Replication persistiti.
```

MySQL Router viene avviato dopo il bootstrap completato con successo.

## Verifica dello stato

Controlla che i tre membri siano `ONLINE` e identifica il `PRIMARY`:

```powershell
docker compose exec mysql-server-1 mysql -uroot -pmysql -e "SELECT MEMBER_HOST, MEMBER_STATE, MEMBER_ROLE FROM performance_schema.replication_group_members"
```

Verifica che le variabili di Group Replication siano state persistite, ad
esempio sul nodo 2:

```powershell
docker compose exec mysql-server-2 mysql -uroot -pmysql -e "SELECT VARIABLE_NAME, VARIABLE_VALUE FROM performance_schema.persisted_variables WHERE VARIABLE_NAME LIKE 'group_replication_%'"
```

### Servizi e porte

| Servizio | Porta host | Funzione |
| --- | --- | --- |
| `mysql-server-1` | `3301` | Nodo MySQL |
| `mysql-server-2` | `3302` | Nodo MySQL |
| `mysql-server-3` | `3303` | Nodo MySQL |
| `mysql-router` | `6446` | Connessioni read/write verso il PRIMARY |
| `mysql-router` | `6447` | Connessioni read-only |
| `dbwebapp` | `8080` | Applicazione web di esempio |

Le porte pubblicate sono accessibili da `127.0.0.1`.

## Prova di failover e rientro

1. Arresta il nodo 2 e attendi che non risulti più `ONLINE`:

   ```powershell
   docker compose stop mysql-server-2
   ```

2. Riavvia il nodo 2:

   ```powershell
   docker compose start mysql-server-2
   ```

3. Ripeti la query sulla tabella `replication_group_members` e **attendi
   che tutti e tre i membri siano nuovamente `ONLINE`**.

4. Arresta il nodo 3, quindi verifica che i nodi 1 e 2 mantengano il quorum
   e che il servizio read/write di Router rimanga disponibile:

   ```powershell
   docker compose stop mysql-server-3
   ```

5. Riavvia il nodo 3 e verifica il suo rientro:

   ```powershell
   docker compose start mysql-server-3
   ```

**Un container avviato non è necessariamente un membro `ONLINE`.**
In un cluster a tre membri sono necessari almeno due membri comunicanti
per mantenere il quorum. Prima di arrestare un secondo nodo, verifica sempre
che il primo sia rientrato nel gruppo.

Per esercitare anche l'elezione di un nuovo PRIMARY, arresta il nodo che
risulta `PRIMARY` dalla query di stato, mantenendo disponibili gli altri due.

## Persistenza e inizializzazione

- Ogni nodo conserva i propri dati in un volume Docker dedicato.
- Le impostazioni di Group Replication vengono salvate con
  `SET PERSIST_ONLY`; `group_replication_start_on_boot` è abilitato.
- I nodi vengono aggiunti al cluster mediante `recoveryMethod: 'clone'`
  **solo se non sono già registrati e non contengono schemi applicativi**.
  Clone sovrascrive i dati locali del destinatario.
- Se il bootstrap è stato interrotto dopo la creazione del cluster, un nuovo
  avvio può completare l'aggiunta dei membri mancanti. Un membro già
  registrato ma non `ONLINE` richiede invece una diagnosi esplicita.

Non usare la clonazione per recuperare automaticamente nodi che contengono
dati da conservare.

## Arresto e ripristino dell'ambiente

Per arrestare i container senza eliminare i dati:

```powershell
docker compose down
```

Il riavvio dell'intero cluster dopo un arresto completo è uno scenario
diverso dal rientro di un singolo nodo. Potrebbe essere necessaria una
procedura amministrativa con `dba.rebootClusterFromCompleteOutage()`,
dopo aver verificato lo stato e i GTID dei membri. Lo script non forza
automaticamente una nuova membership.

Per **ricreare da zero** un ambiente senza dati da conservare:

```powershell
docker compose down -v
docker compose up -d
```

**Attenzione: `docker compose down -v` elimina definitivamente i dati dei
volumi del progetto.** Non utilizzare questo comando su ambienti da preservare
e non cambiare semplicemente il tag dell'immagine su volumi creati con
versioni diverse di MySQL senza una procedura di upgrade.

## Risoluzione dei problemi

Se il bootstrap non termina correttamente:

```powershell
docker compose ps -a
docker compose logs --tail=200 mysql-shell
docker compose logs --tail=200 mysql-server-1 mysql-server-2 mysql-server-3
```

La configurazione utilizza `mysqlsh --no-defaults` per evitare che la
MySQL Shell tenti di usare un socket locale invece del server raggiungibile
tramite la rete Docker. I server impostano
`binlog_transaction_dependency_tracking=WRITESET` e
`transaction_write_set_extraction=XXHASH64`, necessari alla validazione
AdminAPI di questa versione.

Se una modifica riguarda gli argomenti di avvio di `mysqld`, ricrea i
container interessati con `docker compose up -d --force-recreate` **senza
eliminare i volumi**, salvo che sia esplicitamente necessario ripartire da zero.
