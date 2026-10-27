import test from 'node:test';
import assert from 'node:assert/strict';
import db from '../server/db.js';
import {
  detectChanges,
  findInfoTableDocumentFromHtmlIndex,
  parseInfoTable,
  resolveTicker,
} from '../server/hedgeFund.js';

function cleanupTestManager(): void {
  db.prepare(`DELETE FROM hedge_fund_changes WHERE manager_id = 'test_manager'`).run();
  db.prepare(`DELETE FROM hedge_fund_holdings WHERE manager_id = 'test_manager'`).run();
  db.prepare(`DELETE FROM hedge_fund_managers WHERE id = 'test_manager'`).run();
}

test.beforeEach(cleanupTestManager);
test.after(cleanupTestManager);

test('13F infoTable XML parsing extracts holdings rows', () => {
  const xml = `
    <informationTable>
      <infoTable>
        <nameOfIssuer>Apple Inc</nameOfIssuer>
        <cusip>037833100</cusip>
        <value>150000</value>
        <sshPrnamt>2500000</sshPrnamt>
      </infoTable>
      <infoTable>
        <nameOfIssuer>NVIDIA CORP</nameOfIssuer>
        <cusip>67066G104</cusip>
        <value>275000</value>
        <sshPrnamt>1200000</sshPrnamt>
      </infoTable>
    </informationTable>
  `;

  const rows = parseInfoTable(xml);

  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.cusip, '037833100');
  assert.equal(rows[1]?.shares, 1_200_000);
});

test('13F infoTable XML parsing supports namespace-prefixed tags', () => {
  const xml = `
    <ns1:informationTable xmlns:ns1="http://www.sec.gov/edgar/document/thirteenf/informationtable">
      <ns1:infoTable>
        <ns1:nameOfIssuer>Advanced Micro Devices Inc</ns1:nameOfIssuer>
        <ns1:cusip>007903107</ns1:cusip>
        <ns1:value>801427625</ns1:value>
        <ns1:shrsOrPrnAmt>
          <ns1:sshPrnamt>3742191</ns1:sshPrnamt>
        </ns1:shrsOrPrnAmt>
      </ns1:infoTable>
    </ns1:informationTable>
  `;

  const rows = parseInfoTable(xml);

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.cusip, '007903107');
  assert.equal(rows[0]?.shares, 3_742_191);
});

test('HTML filing index parsing finds the infotable XML document', () => {
  const html = `
    <table>
      <tr>
        <td scope="row"><a href="/Archives/edgar/data/1336528/000117266126001091/xslForm13F_X02/primary_doc.xml">primary_doc.html</a></td>
        <td scope="row">13F-HR</td>
      </tr>
      <tr>
        <td scope="row"><a href="/Archives/edgar/data/1336528/000117266126001091/xslForm13F_X02/MSFS13F123125.xml">MSFS13F123125.html</a></td>
        <td scope="row">INFORMATION TABLE</td>
      </tr>
      <tr>
        <td scope="row"><a href="/Archives/edgar/data/1336528/000117266126001091/MSFS13F123125.xml">MSFS13F123125.xml</a></td>
        <td scope="row">INFORMATION TABLE</td>
      </tr>
    </table>
  `;

  assert.equal(findInfoTableDocumentFromHtmlIndex(html), 'MSFS13F123125.xml');
});

test('change detection marks new, reduced, and exited holdings correctly', () => {
  db.prepare(`
    INSERT INTO hedge_fund_managers (id, name, cik, style, active)
    VALUES ('test_manager', 'Test Manager', '9999999999', 'growth', 0)
  `).run();

  db.prepare(`
    INSERT INTO hedge_fund_holdings
      (id, manager_id, period_of_report, accession_number, filed_date, cusip, ticker, issuer_name, shares, value_thousands)
    VALUES
      ('h1', 'test_manager', '2025-09-30', 'accn-1', '2025-11-14', '037833100', 'AAPL', 'Apple Inc', 1000, 100),
      ('h2', 'test_manager', '2025-09-30', 'accn-1', '2025-11-14', '67066G104', 'NVDA', 'NVIDIA Corp', 2000, 200)
  `).run();

  const changes = detectChanges('test_manager', '2025-12-31', [
    { cusip: '037833100', issuerName: 'Apple Inc', shares: 700, valueThousands: 90 },
    { cusip: '594918104', issuerName: 'Microsoft Corp', shares: 800, valueThousands: 110 },
  ]);

  assert.ok(changes.some(change => change.cusip === '594918104' && change.changeType === 'new' && change.isSignificant));
  assert.ok(changes.some(change => change.cusip === '037833100' && change.changeType === 'reduced' && change.isSignificant));
  assert.ok(changes.some(change => change.cusip === '67066G104' && change.changeType === 'exited' && change.isSignificant));

  cleanupTestManager();
});

test('unmapped CUSIPs remain unresolved', () => {
  assert.equal(resolveTicker('000000000', 'Mystery Holdings Ltd'), null);
});
