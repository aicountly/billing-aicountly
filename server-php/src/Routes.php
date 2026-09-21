<?php

declare(strict_types=1);

namespace Aicountly\Api;

use Aicountly\Api\Controllers\BankWithdrawalsController;
use Aicountly\Api\Controllers\CatalogController;
use Aicountly\Api\Controllers\DashboardController;
use Aicountly\Api\Controllers\DashboardsController;
use Aicountly\Api\Controllers\DuesController;
use Aicountly\Api\Controllers\ExpensesController;
use Aicountly\Api\Controllers\ManageController;
use Aicountly\Api\Controllers\MoneyController;
use Aicountly\Api\Controllers\ProfilesController;
use Aicountly\Api\Controllers\ReportsController;
use Aicountly\Api\Controllers\ScheduleController;
use Aicountly\Api\Controllers\SettingsController;
use Aicountly\Api\Controllers\TransactionsController;

final class Routes
{
    public static function register(Router $router): void
    {
        // Session, business mode and the menu it produces.
        // The company switcher. Live reads from Manage, NOT company-scoped --
        // this is what the caller uses to choose the company in the first place.
        $router->get('v1/manage/companies', [ManageController::class, 'companies']);
        $router->get('v1/manage/companyinfo', [ManageController::class, 'companyInfo']);

        $router->get('v1/session', [SettingsController::class, 'session']);
        $router->get('v1/settings', [SettingsController::class, 'show']);
        $router->put('v1/settings', [SettingsController::class, 'update']);
        $router->post('v1/onboarding', [SettingsController::class, 'onboard']);

        // Billing profiles — who may see and do what inside this product.
        $router->get('v1/profiles', [ProfilesController::class, 'index']);
        $router->post('v1/profiles', [ProfilesController::class, 'create']);
        $router->put('v1/profiles/{id}', [ProfilesController::class, 'update']);
        $router->get('v1/profiles/{id}/members', [ProfilesController::class, 'members']);
        $router->post('v1/profiles/{id}/members', [ProfilesController::class, 'assign']);
        $router->delete('v1/profiles/{id}/members/{assignmentId}', [ProfilesController::class, 'unassign']);

        // Read-through to the products that own the data.
        $router->get('v1/catalog/items', [CatalogController::class, 'items']);
        $router->get('v1/catalog/items/search', [CatalogController::class, 'searchItems']);
        // The Items screen: the five counts above the list, the group filter,
        // and the list as a file. All three are Inventory's data, read on the
        // request — there is no item table in this product.
        $router->get('v1/catalog/items/stats', [CatalogController::class, 'itemStats']);
        $router->get('v1/catalog/items/export', [CatalogController::class, 'exportItems']);
        $router->get('v1/catalog/item-groups', [CatalogController::class, 'itemGroups']);
        $router->get('v1/catalog/items/favourites', [CatalogController::class, 'favourites']);
        $router->get('v1/catalog/items/barcode/{code}', [CatalogController::class, 'itemByBarcode']);
        // LAST of the four-segment /catalog/items routes. The router takes the
        // first match and `{id}` matches any segment, so declaring it above
        // `search`, `stats`, `export` or `favourites` would swallow all four.
        $router->get('v1/catalog/items/{id}', [CatalogController::class, 'item']);
        $router->get('v1/catalog/stock', [CatalogController::class, 'stock']);
        $router->get('v1/catalog/low-stock', [CatalogController::class, 'lowStock']);
        $router->get('v1/catalog/warehouses', [CatalogController::class, 'warehouses']);
        $router->get('v1/catalog/parties', [CatalogController::class, 'parties']);
        $router->get('v1/catalog/cash-bank', [CatalogController::class, 'cashBankAccounts']);
        $router->get('v1/catalog/expense-accounts', [CatalogController::class, 'expenseAccounts']);
        $router->get('v1/catalog/tax-categories', [CatalogController::class, 'taxCategories']);

        // Transactions. One route per kind, one service behind all of them.
        // kind: sale | purchase | receipt | payment | credit_note | debit_note
        //     | expense | bank_deposit | bank_withdrawal | bank_transfer
        $router->post('v1/transactions/{kind}', [TransactionsController::class, 'create']);
        $router->get('v1/transactions/unfinished', [TransactionsController::class, 'unfinished']);
        // Around the expense form: what was recorded lately, and what this
        // deployment can do with a bill file. Recording one is still
        // POST v1/transactions/expense, above.
        $router->get('v1/expenses/recent', [ExpensesController::class, 'recent']);
        $router->get('v1/expenses/capabilities', [ExpensesController::class, 'capabilities']);
        $router->post('v1/expenses/read-bill', [ExpensesController::class, 'readBill']);
        // Around the bank-withdrawal form: what this product withdrew lately,
        // and how much has come out of the chosen bank in the last month.
        // Recording one is still POST v1/transactions/bank_withdrawal, above.
        $router->get('v1/bank-withdrawals/recent', [BankWithdrawalsController::class, 'recent']);
        $router->get('v1/bank-withdrawals/summary', [BankWithdrawalsController::class, 'summary']);
        // Invoices a credit note (or bills a debit note) can be raised against,
        // and — for one of them — the lines that were billed on it, so the note
        // can start from what was sold instead of an empty table.
        $router->get('v1/original-documents', [TransactionsController::class, 'originalDocuments']);
        $router->get('v1/original-documents/{voucherId}', [TransactionsController::class, 'originalDocument']);
        // How many credit notes this month, against the window before it.
        $router->get('v1/credit-notes/trend', [TransactionsController::class, 'creditNoteTrend']);
        $router->get('v1/transactions/{id}', [TransactionsController::class, 'show']);
        $router->post('v1/transactions/{id}/retry', [TransactionsController::class, 'retry']);
        $router->get('v1/transactions/{id}/statutory', [TransactionsController::class, 'statutoryStatus']);
        $router->post('v1/transactions/{id}/statutory/{what}', [TransactionsController::class, 'generateStatutory']);

        // The money screens' own context: the period's entries, their totals,
        // and when a party was last paid. Books' register, read on the request.
        $router->get('v1/money/recent', [MoneyController::class, 'recent']);
        $router->get('v1/money/party-context', [MoneyController::class, 'partyContext']);

        // Dues — every figure read live from Books.
        $router->get('v1/receivables', [DuesController::class, 'receivables']);
        $router->get('v1/payables', [DuesController::class, 'payables']);
        $router->get('v1/parties/{accountId}/statement', [DuesController::class, 'statement']);
        $router->get('v1/cash-bank', [DuesController::class, 'cashAndBank']);
        $router->get('v1/open-bills', [DuesController::class, 'openBills']);

        // Recurring bills and payment reminders — business automation, not sync.
        $router->get('v1/recurring', [ScheduleController::class, 'listRecurring']);
        $router->post('v1/recurring', [ScheduleController::class, 'createRecurring']);
        $router->get('v1/recurring/due', [ScheduleController::class, 'dueRecurring']);
        $router->get('v1/recurring/{id}', [ScheduleController::class, 'showRecurring']);
        $router->post('v1/recurring/{id}/run', [ScheduleController::class, 'runRecurring']);
        $router->post('v1/recurring/{id}/status', [ScheduleController::class, 'setRecurringStatus']);

        $router->get('v1/reminders', [ScheduleController::class, 'listReminderRules']);
        $router->post('v1/reminders', [ScheduleController::class, 'createReminderRule']);
        $router->get('v1/reminders/{id}/candidates', [ScheduleController::class, 'reminderCandidates']);
        $router->post('v1/reminders/{id}/log', [ScheduleController::class, 'logReminder']);

        // The five dashboards. Each checks its own permission before it reads
        // anything, so the tab bar and the URL agree about who may open what.
        $router->get('v1/dashboards/overview', [DashboardsController::class, 'overview']);
        $router->get('v1/dashboards/biller', [DashboardsController::class, 'biller']);
        $router->get('v1/dashboards/receivables', [DashboardsController::class, 'receivables']);
        $router->get('v1/dashboards/payables', [DashboardsController::class, 'payables']);
        $router->get('v1/dashboards/cash-compliance', [DashboardsController::class, 'cashCompliance']);
        $router->post('v1/dashboards/day-close', [DashboardsController::class, 'dayCloseStep']);

        // Promises to pay — ours, because no other product records a promise.
        $router->post('v1/promises', [DashboardsController::class, 'recordPromise']);
        $router->post('v1/promises/{id}/status', [DashboardsController::class, 'setPromiseStatus']);

        // Reports. Books' own registers, read live and printable.
        $router->get('v1/reports', [ReportsController::class, 'index']);
        $router->get('v1/reports/{key}', [ReportsController::class, 'run']);
        $router->get('v1/reports/{key}/export', [ReportsController::class, 'export']);

        // The short list the bell and the overview both read, and the state of
        // anything that has not reached Books.
        $router->get('v1/insights', [DashboardController::class, 'insights']);
        $router->get('v1/integration-commands', [DashboardController::class, 'commands']);
    }
}
