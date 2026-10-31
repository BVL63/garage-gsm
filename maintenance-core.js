/* АЛЛО, ГАРАЖ! — data helpers for maintenance and driver settlements.
   This file is deliberately independent of the existing waybill calculations.
   Integration with index.html and UI is a separate step. */
(function (root) {
  'use strict';
  const STATUSES = Object.freeze(['Открыт', 'Завершён', 'Подтверждён']);
  const amount = value => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) throw new Error('Сумма должна быть неотрицательной');
    return Math.round((n + Number.EPSILON) * 100) / 100;
  };
  const sum = values => Math.round(values.reduce((total, value) => total + amount(value), 0) * 100) / 100;
  const rowCost = row => amount(amount(row.quantity ?? 1) * amount(row.unitPrice ?? 0));
  const unique = rows => {
    const ids = new Set();
    for (const row of rows) {
      if (!row.id || ids.has(row.id)) throw new Error('Отсутствует или повторяется ID строки');
      ids.add(row.id);
    }
  };
  function validateRepair(repair) {
    if (!repair?.id || !repair.carId || !repair.startDate) throw new Error('Укажите ID, автомобиль и дату начала');
    if (!STATUSES.includes(repair.status)) throw new Error('Неизвестный статус ремонта');
    if (repair.endDate && repair.endDate < repair.startDate) throw new Error('Дата окончания раньше начала');
    if (repair.odometerStart != null && (!Number.isFinite(Number(repair.odometerStart)) || Number(repair.odometerStart) < 0))
      throw new Error('Некорректный одометр');
    unique([...(repair.works || []), ...(repair.parts || [])]);
    for (const row of [...(repair.works || []), ...(repair.parts || [])]) rowCost(row);
    return true;
  }
  // Only approved driver-paid line items generate a debt. Payments are separate.
  // A repair's completed status alone must not imply approval.
  function driverExpenses(repairs) {
    const items = [];
    for (const repair of repairs || []) {
      validateRepair(repair);
      if (repair.status !== 'Подтверждён') continue;
      for (const [kind, rows] of [['work', repair.works || []], ['part', repair.parts || []]]) {
        for (const row of rows) {
          if (row.payer !== 'driver') continue;
          if (!row.paidByDriverId) throw new Error('Не указан водитель-плательщик');
          items.push({
            id: repair.id + ':' + kind + ':' + row.id,
            repairId: repair.id, carId: repair.carId,
            driverId: row.paidByDriverId, date: row.date || repair.startDate,
            kind, amount: rowCost(row)
          });
        }
      }
    }
    return items;
  }
  function repairTotals(repair) {
    validateRepair(repair);
    const works = sum((repair.works || []).map(rowCost));
    const parts = sum((repair.parts || []).map(rowCost));
    return { works, parts, total: sum([works, parts]) };
  }
  // Reimbursements are NOT a second repair cost; they only reduce outstanding debt.
  function settlementBalances(repairs, reimbursements) {
    const expenses = driverExpenses(repairs);
    const balances = new Map();
    const ensure = id => {
      if (!balances.has(id)) balances.set(id, { driverId: id, accrued: 0, reimbursed: 0, outstanding: 0 });
      return balances.get(id);
    };
    for (const expense of expenses) ensure(expense.driverId).accrued += expense.amount;
    const ids = new Set();
    for (const payment of reimbursements || []) {
      if (!payment.id || ids.has(payment.id)) throw new Error('Повторный ID выплаты');
      ids.add(payment.id);
      if (!payment.driverId || !payment.date) throw new Error('Не заполнена выплата');
      ensure(payment.driverId).reimbursed += amount(payment.amount);
    }
    for (const balance of balances.values()) {
      balance.accrued = amount(balance.accrued);
      balance.reimbursed = amount(balance.reimbursed);
      balance.outstanding = amount(Math.max(0, balance.accrued - balance.reimbursed));
      if (balance.reimbursed > balance.accrued) throw new Error('Возмещение превышает подтверждённые расходы водителя');
    }
    return [...balances.values()];
  }
  root.GarageMaintenance = Object.freeze({ STATUSES, validateRepair, repairTotals, driverExpenses, settlementBalances });
})(typeof window !== 'undefined' ? window : globalThis);
