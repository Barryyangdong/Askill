import assert from 'node:assert/strict';
import { test } from 'node:test';
import { linkedPlayerTable as enrich } from '../src/verticals/finance/lib/playerClipboard.ts';

const cell = (text:string, ...links:string[]) => ({text, links});
const card = (id:string, seq:string) => `https://www.tgb.cn/spmatch/gains/readInfo?lookeUserID=${id}&spmatchSeq=${seq}`;
const blog = (id:string) => `https://www.tgb.cn/blog/${id}`;
const header = [cell('昵称'), cell('当日收益率')];
function linkedPlayerTable(grid: Parameters<typeof enrich>[0], seq?: string) {
  const plain = grid.map(row=>row.map(c=>c.text).join('\t')).join('\n');
  return enrich(grid, seq, plain);
}

test('从官网选手链接识别稳定 ID，保留同名选手、列名和打星值', () => {
  const result = linkedPlayerTable([header,
    [cell('同名', blog('100'), card('100','881')), cell('1.2%')],
    [cell('同名', 'https://www.taoguba.com.cn/blog/200/'), cell('＊＊＊')],
  ], '881');
  assert.deepEqual(result?.table, {columns:['昵称','当日收益率','选手 ID'], rows:[['同名','1.2%','100'],['同名','＊＊＊','200']]});
  assert.equal(result?.sourceSpmatchSeq, '881');
  assert.equal(linkedPlayerTable([header, [cell('甲',blog('100')), cell('0')]])?.sourceSpmatchSeq, undefined);
});

test('战绩链接赛事须匹配已知序号，没有参赛卡序号时也拒绝混合赛事', () => {
  const rows = [header, [cell('甲', card('100','881')), cell('0')]];
  assert.throws(() => linkedPlayerTable(rows, '882'), /赛事序号/);
  assert.throws(() => linkedPlayerTable([...rows, [cell('乙', card('200','882')),cell('0')]]), /赛事序号/);
});

test('拒绝一行多位选手、战绩参数不唯一及部分选手缺失 ID', () => {
  assert.throws(() => linkedPlayerTable([header, [cell('甲', blog('100'), card('200','881')),cell('')]]), /多位选手/);
  assert.throws(() => linkedPlayerTable([header, [cell('甲', card('100','881')+'&lookeUserID=200'),cell('')]]), /唯一/);
  assert.throws(() => linkedPlayerTable([header, [cell('甲',blog('100')),cell('')],[cell('乙'),cell('')]]), /第 3 行缺少/);
});

test('已有 ID 列保留，遇到与链接冲突的值须重选', () => {
  const grid = [[cell('昵称'),cell('用户ID')],[cell('甲',blog('100')),cell('100')],[cell('乙'),cell('200')]];
  assert.deepEqual(linkedPlayerTable(grid)?.table.rows, [['甲','100'],['乙','200']]);
  grid[1]![1] = cell('200');
  assert.throws(() => linkedPlayerTable(grid), /不符/);
});

test('无可识别绝对官网链接时交回纯文本流程', () => {
  for (const link of ['https://www.tgb.cn.invalid/blog/100','https://www.tgb.cn@invalid.test/blog/100',
    'https://www.tgb.cn:444/blog/100','http://www.tgb.cn/blog/100','/blog/100','javascript:void(0)']) {
    assert.equal(linkedPlayerTable([header, [cell('甲',link),cell('0')]]),null);
  }
});

test('未知样式造成 HTML 与可见内容不一致时回退纯文本，赛事冲突仍拦截', () => {
  const grid = [[cell('昵称'),cell('持仓代码')],[cell('甲',card('100','881')),cell('＊＊＊ 600001')]];
  const plain = '昵称\t持仓代码\n甲\t＊＊＊';
  assert.equal(enrich(grid, '881', plain), null);
  assert.equal(enrich(grid, '881', ''), null);
  assert.throws(() => enrich(grid, '882', plain), /赛事序号/);
});
