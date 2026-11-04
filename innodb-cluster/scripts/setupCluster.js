// MySQL Shell 8.0.x, laboratorio locale. Credenziali SOLO dimostrative.
// Non forzare mai il bootstrap dopo un outage completo.
var dbPass = 'mysql';
var clusterName = 'devCluster';
var hosts = ['mysql-server-1', 'mysql-server-2', 'mysql-server-3'];

function instance(host) {
  return {user: 'root', host: host, port: 3306, password: dbPass};
}

function persistGroupReplication(host) {
  var s = mysql.getClassicSession(instance(host));
  try {
    // Salva i valori effettivamente negoziati da AdminAPI, non inventare un UUID.
    var names = [
      'group_replication_group_name',
      'group_replication_local_address',
      'group_replication_group_seeds',
      'group_replication_single_primary_mode',
      'group_replication_enforce_update_everywhere_checks'
    ];
    for (var i = 0; i < names.length; i++) {
      s.runSql('SET PERSIST_ONLY ' + names[i] + ' = @@GLOBAL.' + names[i]);
    }
    s.runSql('SET PERSIST group_replication_start_on_boot = ON');
    var rows = s.runSql(
      "SELECT VARIABLE_NAME FROM performance_schema.persisted_variables " +
      "WHERE VARIABLE_NAME IN ('group_replication_group_name', " +
      "'group_replication_local_address', 'group_replication_group_seeds')"
    ).fetchAll();
    if (rows.length !== 3) {
      throw new Error('Persistenza GR non verificata su ' + host +
        ' (attese 3 variabili, trovate ' + rows.length + ')');
    }
    print('Group Replication persistita su ' + host);
  } finally {
    s.close();
  }
}


// Solo per istanze SECONDARY nuove e sacrificabili del laboratorio.
// Clone sovrascrive completamente il datadir del destinatario. Non usare
// questa funzione su nodi che contengono database degli studenti.
function addDisposableSecondaryIfMissing(cluster, host) {
  var address = host + ':3306';
  var topology = cluster.status().defaultReplicaSet.topology;
  for (var key in topology) {
    if (!Object.prototype.hasOwnProperty.call(topology, key)) continue;
    if (key === address || topology[key].address === address) {
      if (topology[key].status === 'ONLINE') {
        print('Nodo ' + address + ' gia ONLINE: nessun clone.');
        return;
      }
      throw new Error(address + ' e gia registrato nel cluster ma non ONLINE. ' +
        'Nessuna sovrascrittura automatica: eseguire diagnosi/rejoin manuale.');
    }
  }

  var s = mysql.getClassicSession(instance(host));
  try {
    // Un nodo nuovo del laboratorio non deve contenere database applicativi.
    // E' una salvaguardia, non un sistema di backup o di verifica dei dati.
    var schemas = s.runSql(
      "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA " +
      "WHERE SCHEMA_NAME NOT IN " +
      "('mysql', 'information_schema', 'performance_schema', 'sys')"
    ).fetchAll();
    if (schemas.length !== 0) {
      throw new Error('Clone RIFIUTATO su ' + host +
        ': presenti database non di sistema (' + schemas.length +
        '). Proteggere i dati ed eseguire un recupero manuale.');
    }
  } finally {
    s.close();
  }

  print('Aggiunta di ' + address + ' con Clone: SOLO nodo vuoto del laboratorio.');
  cluster.addInstance(instance(host), {
    localAddress: host + ':33061',
    recoveryMethod: 'clone'
  });
}

try {
  shell.connect('mysql://root@mysql-server-1:3306', dbPass);
  var session = shell.getSession();
  var metadata = session.runSql(
    "SELECT COUNT(*) FROM information_schema.SCHEMATA " +
    "WHERE SCHEMA_NAME = 'mysql_innodb_cluster_metadata'"
  ).fetchOne();
  var cluster;

  if (Number(metadata[0]) === 0) {
    print('Creazione InnoDB Cluster ' + clusterName);
    cluster = dba.createCluster(clusterName, {
      communicationStack: 'XCOM',
      localAddress: 'mysql-server-1:33061'
    });
  } else {
    // La prima esecuzione potrebbe essersi fermata DOPO createCluster().
    // Riusiamo il cluster, senza ricrearlo o forzare il quorum.
    print('Cluster esistente: verifica dei membri e ripresa sicura del bootstrap.');
    cluster = dba.getCluster(clusterName);
  }

  // Aggiungere solo nodi mai registrati. Non clonare automaticamente un nodo
  // offline o una precedente replica: potrebbe contenere dati importanti.
  addDisposableSecondaryIfMissing(cluster, 'mysql-server-2');
  addDisposableSecondaryIfMissing(cluster, 'mysql-server-3');

  var topology = cluster.status().defaultReplicaSet.topology;
  var online = 0;
  for (var key in topology) {
    if (Object.prototype.hasOwnProperty.call(topology, key) &&
        topology[key].status === 'ONLINE') online++;
  }
  if (online !== 3) {
    throw new Error('Attesi 3 nodi ONLINE, trovati ' + online +
      '. Bootstrap interrotto: verificare lo stato del cluster.');
  }
  for (var j = 0; j < hosts.length; j++) {
    persistGroupReplication(hosts[j]);
  }
  print('Cluster pronto: 3 ONLINE; parametri Group Replication persistiti.');
} catch (err) {
  print('FATAL: bootstrap o verifica falliti: ' + err.message);
  throw err; // Non mascherare gli errori (la vecchia immagine usava || true).
}
