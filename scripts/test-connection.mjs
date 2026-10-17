import neo4j from 'neo4j-driver';
import fs from 'fs';
import path from 'path';


const envContent = fs.readFileSync(path.resolve(process.cwd(), '.env'), 'utf-8');
const env = {};
envContent.split('\n').forEach(line => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return;
  const match = trimmed.match(/^([\w.-]+)\s*=\s*(.*)?$/);
  if (match) {
    let value = match[2] || '';
    value = value.trim().replace(/^['"]|['"]$/g, '');
    env[match[1]] = value;
  }
});

const uri = env.NEO4J_URI;
const password = env.NEO4J_PASSWORD;
const possibleUsers = [env.NEO4J_USERNAME, 'neo4j'].filter(Boolean);

async function tryConnect(user) {
  console.log(`\nAttempting connection to ${uri} with user '${user}'...`);
  const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  const session = driver.session({ database: env.NEO4J_DATABASE || 'neo4j' });
  try {
    const serverInfo = await driver.getServerInfo();
    console.log('✓ Successfully connected to Neo4j AuraDB!');
    console.log(`Server version: ${serverInfo.agent}`);

    // Check existing labels
    const labelsResult = await session.run('CALL db.labels() YIELD label RETURN label');
    const labels = labelsResult.records.map(r => r.get('label'));
    console.log('\nExisting Labels in database:', labels.length > 0 ? labels : 'None (database is empty)');

    // Check total nodes count
    const countResult = await session.run('MATCH (n) RETURN count(n) AS count');
    const count = countResult.records[0].get('count').toString();
    console.log(`Total nodes in database: ${count}`);

    // If there are nodes, print a few sample nodes
    if (parseInt(count, 10) > 0) {
      const sampleResult = await session.run('MATCH (n) RETURN labels(n) AS labels, properties(n) AS props LIMIT 10');
      console.log('\nSample Nodes:');
      sampleResult.records.forEach((r, idx) => {
        console.log(`Node ${idx + 1}: [${r.get('labels').join(', ')}]`, JSON.stringify(r.get('props')));
      });
    }

    // Check relationship types
    const relsResult = await session.run('CALL db.relationshipTypes() YIELD relationshipType RETURN relationshipType');
    const rels = relsResult.records.map(r => r.get('relationshipType'));
    console.log('\nExisting Relationship Types:', rels.length > 0 ? rels : 'None');

    return { success: true, user };
  } catch (err) {
    console.log(`Failed with user '${user}': ${err.message}`);
    return { success: false, error: err.message };
  } finally {
    await session.close();
    await driver.close();
  }
}

async function main() {
  for (const user of possibleUsers) {
    const res = await tryConnect(user);
    if (res.success) return;
  }
}

main();

