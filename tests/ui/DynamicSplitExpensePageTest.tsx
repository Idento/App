import {fireEvent, render, screen} from '@testing-library/react-native';

import ComposeProviders from '@components/ComposeProviders';
import {LocaleContextProvider} from '@components/LocaleContextProvider';
import OnyxListItemProvider from '@components/OnyxListItemProvider';
import type {SplitListItemType} from '@components/SelectionList/ListItem/types';

import type {PlatformStackScreenProps} from '@libs/Navigation/PlatformStackNavigation/types';
import type {MoneyRequestNavigatorParamList} from '@libs/Navigation/types';

import DynamicSplitExpensePage from '@pages/iou/DynamicSplitExpensePage';
import updateSplitTransactionsFromSplitExpensesFlow from '@pages/iou/updateSplitTransactionsFromSplitExpensesFlow';

import CONST from '@src/CONST';
import ONYXKEYS from '@src/ONYXKEYS';
import SCREENS from '@src/SCREENS';
import type {Policy, Report, Transaction} from '@src/types/onyx';
import type {SearchResultDataType} from '@src/types/onyx/SearchResults';

import React from 'react';
import Onyx from 'react-native-onyx';

import createRandomTransaction from '../utils/collections/transaction';
import createMock from '../utils/createMock';
import waitForBatchedUpdatesWithAct from '../utils/waitForBatchedUpdatesWithAct';

const CURRENT_USER_ACCOUNT_ID = 1;
const CURRENT_USER_LOGIN = 'current-user@example.com';
const SELF_DM_REPORT_ID = 'selfDM';
const APPROVED_REPORT_ID = 'approvedReport';
const ORIGINAL_TRANSACTION_ID = 'original';
const OPEN_SPLIT_TRANSACTION_ID = 'openSplit';
const FROZEN_SPLIT_TRANSACTION_ID = 'frozenSplit';

let capturedSplitListData: SplitListItemType[] = [];
let mockSearchResultsData: SearchResultDataType | undefined;

jest.mock('@components/Search/SearchContext', () => ({
    useSearchResultsContext: jest.fn(() => ({
        currentSearchResults: mockSearchResultsData ? {data: mockSearchResultsData} : undefined,
    })),
    useSearchQueryContext: jest.fn(() => ({
        currentSearchHash: 0,
        currentSearchQueryJSON: undefined,
    })),
    useSearchSelectionActions: jest.fn(() => ({
        clearSelectedTransactions: jest.fn(),
    })),
}));

jest.mock('@hooks/useCurrentUserPersonalDetails', () =>
    jest.fn(() => ({
        accountID: 1,
        login: 'current-user@example.com',
        email: 'current-user@example.com',
    })),
);

jest.mock('@hooks/useDynamicBackPath', () => jest.fn(() => 'search'));

jest.mock('@libs/Navigation/Navigation', () => ({
    goBack: jest.fn(),
    navigate: jest.fn(),
    dismissModal: jest.fn(),
}));

jest.mock('@components/ScreenWrapper', () => {
    function MockScreenWrapper({children}: {children: React.ReactNode}) {
        return children;
    }
    return MockScreenWrapper;
});

jest.mock('@components/HeaderWithBackButton', () => () => null);

jest.mock('@components/CollapsibleHeaderOnKeyboard', () => {
    function MockCollapsibleHeaderOnKeyboard({children}: {children: React.ReactNode}) {
        return children;
    }
    return MockCollapsibleHeaderOnKeyboard;
});

// Render only the amount tab synchronously - the real material top tab navigator needs a navigation container.
jest.mock('@libs/Navigation/OnyxTabNavigator', () => {
    function MockOnyxTabNavigator({children}: {children: React.ReactNode}) {
        return children;
    }
    function MockScreen({name, children}: {name: string; children: () => React.ReactNode}) {
        return name === 'amount' ? children() : null;
    }
    function MockTabScreenWithFocusTrapWrapper({children}: {children: React.ReactNode}) {
        return children;
    }
    return {
        __esModule: true,
        default: MockOnyxTabNavigator,
        TopTab: {Screen: MockScreen},
        TabScreenWithFocusTrapWrapper: MockTabScreenWithFocusTrapWrapper,
    };
});

jest.mock('@pages/iou/updateSplitTransactionsFromSplitExpensesFlow', () => jest.fn());

jest.mock('@pages/iou/SplitList', () => {
    function MockSplitList({data}: {data: SplitListItemType[]}) {
        capturedSplitListData = data;
        return null;
    }
    return MockSplitList;
});

type DynamicSplitExpensePageProps = PlatformStackScreenProps<MoneyRequestNavigatorParamList, typeof SCREENS.MONEY_REQUEST.DYNAMIC_SPLIT_EXPENSE_SEARCH>;

function makeTransaction(transactionID: string, reportID: string, amount: number): Transaction {
    // Pin status - createRandomTransaction randomizes it, and isSplitAction treats PENDING as non-editable.
    return {
        ...createRandomTransaction(0),
        transactionID,
        reportID,
        amount,
        currency: CONST.CURRENCY.USD,
        status: CONST.TRANSACTION.STATUS.POSTED,
    };
}

function renderPage(splitReportID = SELF_DM_REPORT_ID) {
    const route = createMock<DynamicSplitExpensePageProps['route']>({
        key: 'DynamicSplitExpenseSearch',
        name: SCREENS.MONEY_REQUEST.DYNAMIC_SPLIT_EXPENSE_SEARCH,
        params: {
            splitReportID,
            originalTransactionID: ORIGINAL_TRANSACTION_ID,
            splitExpenseTransactionID: OPEN_SPLIT_TRANSACTION_ID,
        },
    });
    return render(
        <ComposeProviders components={[OnyxListItemProvider, LocaleContextProvider]}>
            <DynamicSplitExpensePage
                route={route}
                navigation={createMock<DynamicSplitExpensePageProps['navigation']>({})}
            />
        </ComposeProviders>,
    );
}

describe('DynamicSplitExpensePage', () => {
    beforeAll(() => {
        Onyx.init({keys: ONYXKEYS});
    });

    beforeEach(async () => {
        capturedSplitListData = [];
        mockSearchResultsData = undefined;
        await Onyx.clear();

        const selfDMReport: Report = {
            reportID: SELF_DM_REPORT_ID,
            chatType: CONST.REPORT.CHAT_TYPE.SELF_DM,
            ownerAccountID: CURRENT_USER_ACCOUNT_ID,
            stateNum: CONST.REPORT.STATE_NUM.OPEN,
            statusNum: CONST.REPORT.STATUS_NUM.OPEN,
        };
        await Promise.all([
            Onyx.set(ONYXKEYS.SESSION, {
                accountID: CURRENT_USER_ACCOUNT_ID,
                email: CURRENT_USER_LOGIN,
            }),
            Onyx.set(`${ONYXKEYS.COLLECTION.REPORT}${SELF_DM_REPORT_ID}`, selfDMReport),
            Onyx.set(`${ONYXKEYS.COLLECTION.TRANSACTION}${ORIGINAL_TRANSACTION_ID}`, makeTransaction(ORIGINAL_TRANSACTION_ID, SELF_DM_REPORT_ID, 300)),
            Onyx.set(`${ONYXKEYS.COLLECTION.TRANSACTION}${OPEN_SPLIT_TRANSACTION_ID}`, makeTransaction(OPEN_SPLIT_TRANSACTION_ID, SELF_DM_REPORT_ID, 100)),
            Onyx.set(`${ONYXKEYS.COLLECTION.SPLIT_TRANSACTION_DRAFT}${ORIGINAL_TRANSACTION_ID}`, {
                ...makeTransaction(ORIGINAL_TRANSACTION_ID, SELF_DM_REPORT_ID, 300),
                comment: {
                    originalTransactionID: ORIGINAL_TRANSACTION_ID,
                    splitExpenses: [
                        {
                            transactionID: OPEN_SPLIT_TRANSACTION_ID,
                            amount: 100,
                            created: '2024-01-01',
                        },
                        {
                            transactionID: FROZEN_SPLIT_TRANSACTION_ID,
                            amount: 200,
                            created: '2024-01-01',
                        },
                    ],
                },
            }),
        ]);
        await waitForBatchedUpdatesWithAct();
    });

    it('marks a split whose approved report is only in search results data as non-editable', async () => {
        // Given a split opened from Spend whose transaction and approved report are only in the search snapshot, not in Onyx
        const searchResultsData: SearchResultDataType = {};
        searchResultsData[`${ONYXKEYS.COLLECTION.TRANSACTION}${FROZEN_SPLIT_TRANSACTION_ID}`] = makeTransaction(FROZEN_SPLIT_TRANSACTION_ID, APPROVED_REPORT_ID, 200);
        searchResultsData[`${ONYXKEYS.COLLECTION.REPORT}${APPROVED_REPORT_ID}`] = {
            reportID: APPROVED_REPORT_ID,
            type: CONST.REPORT.TYPE.EXPENSE,
            stateNum: CONST.REPORT.STATE_NUM.APPROVED,
            statusNum: CONST.REPORT.STATUS_NUM.APPROVED,
        };
        mockSearchResultsData = searchResultsData;

        // When the split page renders its rows
        renderPage();
        await waitForBatchedUpdatesWithAct();

        // Then the frozen split's row is read-only, matching the actions that ignore edits to it, while the open split stays editable
        const openRow = capturedSplitListData.find((item) => item.transactionID === OPEN_SPLIT_TRANSACTION_ID);
        const frozenRow = capturedSplitListData.find((item) => item.transactionID === FROZEN_SPLIT_TRANSACTION_ID);
        expect(openRow?.isEditable).toBe(true);
        expect(frozenRow?.isEditable).toBe(false);
    });

    it('keeps a split editable when its report in search results data is still open', async () => {
        // Given the same split from Spend, but its report is still open, so its amount may absorb changes
        const searchResultsData: SearchResultDataType = {};
        searchResultsData[`${ONYXKEYS.COLLECTION.TRANSACTION}${FROZEN_SPLIT_TRANSACTION_ID}`] = makeTransaction(FROZEN_SPLIT_TRANSACTION_ID, APPROVED_REPORT_ID, 200);
        searchResultsData[`${ONYXKEYS.COLLECTION.REPORT}${APPROVED_REPORT_ID}`] = {
            reportID: APPROVED_REPORT_ID,
            chatType: CONST.REPORT.CHAT_TYPE.SELF_DM,
            stateNum: CONST.REPORT.STATE_NUM.OPEN,
            statusNum: CONST.REPORT.STATUS_NUM.OPEN,
        };
        mockSearchResultsData = searchResultsData;

        // When the split page renders its rows
        renderPage();
        await waitForBatchedUpdatesWithAct();

        // Then both rows stay editable - only frozen splits are locked
        expect(capturedSplitListData).toHaveLength(2);
        expect(capturedSplitListData.every((item) => item.isEditable)).toBe(true);
    });

    describe('saving splits', () => {
        const POLICY_ID = 'splitPolicy';
        const MANAGED_REPORT_ID = 'managedReport';
        const REJECTED_TO_REPORT_ID = 'rejectedToReport';
        const SUBMITTER_ACCOUNT_ID = 3;
        const APPROVER_ACCOUNT_ID = 2;
        const APPROVER_LOGIN = 'approver@example.com';

        function makeExpenseReport(reportID: string, managerID: number, isOpen: boolean): Report {
            return {
                reportID,
                type: CONST.REPORT.TYPE.EXPENSE,
                policyID: POLICY_ID,
                ownerAccountID: SUBMITTER_ACCOUNT_ID,
                managerID,
                stateNum: isOpen ? CONST.REPORT.STATE_NUM.OPEN : CONST.REPORT.STATE_NUM.SUBMITTED,
                statusNum: isOpen ? CONST.REPORT.STATUS_NUM.OPEN : CONST.REPORT.STATUS_NUM.SUBMITTED,
            };
        }

        function makeChild(transactionID: string, reportID: string, amount: number): Transaction {
            return {
                ...makeTransaction(transactionID, reportID, amount),
                comment: {originalTransactionID: ORIGINAL_TRANSACTION_ID, source: CONST.IOU.TYPE.SPLIT},
            };
        }

        beforeEach(() => {
            jest.clearAllMocks();
        });

        async function setUpSplitGroup(rejectedToReportManagerID: number) {
            const policy: Policy = {
                id: POLICY_ID,
                name: 'Workspace',
                type: CONST.POLICY.TYPE.TEAM,
                role: CONST.POLICY.ROLE.USER,
                owner: 'owner@example.com',
                outputCurrency: CONST.CURRENCY.USD,
                approvalMode: CONST.POLICY.APPROVAL_MODE.BASIC,
                approver: APPROVER_LOGIN,
                employeeList: {[CURRENT_USER_LOGIN]: {email: CURRENT_USER_LOGIN, role: CONST.POLICY.ROLE.USER}},
            };
            await Promise.all([
                Onyx.set(`${ONYXKEYS.COLLECTION.POLICY}${POLICY_ID}`, policy),
                Onyx.set(ONYXKEYS.PERSONAL_DETAILS_LIST, {
                    [SUBMITTER_ACCOUNT_ID]: {accountID: SUBMITTER_ACCOUNT_ID, login: 'submitter@example.com'},
                    [APPROVER_ACCOUNT_ID]: {accountID: APPROVER_ACCOUNT_ID, login: APPROVER_LOGIN},
                }),
                Onyx.set(`${ONYXKEYS.COLLECTION.REPORT}${MANAGED_REPORT_ID}`, makeExpenseReport(MANAGED_REPORT_ID, CURRENT_USER_ACCOUNT_ID, false)),
                Onyx.set(`${ONYXKEYS.COLLECTION.REPORT}${REJECTED_TO_REPORT_ID}`, makeExpenseReport(REJECTED_TO_REPORT_ID, rejectedToReportManagerID, true)),
                Onyx.set(`${ONYXKEYS.COLLECTION.TRANSACTION}${ORIGINAL_TRANSACTION_ID}`, makeTransaction(ORIGINAL_TRANSACTION_ID, MANAGED_REPORT_ID, -300)),
                Onyx.set(`${ONYXKEYS.COLLECTION.TRANSACTION}${OPEN_SPLIT_TRANSACTION_ID}`, makeChild(OPEN_SPLIT_TRANSACTION_ID, MANAGED_REPORT_ID, -150)),
                Onyx.set(`${ONYXKEYS.COLLECTION.TRANSACTION}${FROZEN_SPLIT_TRANSACTION_ID}`, makeChild(FROZEN_SPLIT_TRANSACTION_ID, REJECTED_TO_REPORT_ID, -150)),
            ]);
            await waitForBatchedUpdatesWithAct();
        }

        it('shows an error and sends nothing when a split sits on an open report the user cannot edit', async () => {
            // Given a vacation delegate who manages the submitted report, while the rejected split moved to the submitter's open report that the approver manages
            await setUpSplitGroup(APPROVER_ACCOUNT_ID);

            // When the delegate saves changed splits
            renderPage(MANAGED_REPORT_ID);
            await waitForBatchedUpdatesWithAct();
            fireEvent.press(screen.getByText('Save'));
            await waitForBatchedUpdatesWithAct();

            // Then no write is started, because the backend refuses any write to this split group, and the user is told why
            expect(updateSplitTransactionsFromSplitExpensesFlow).not.toHaveBeenCalled();
            expect(screen.getByText("One of these splits is on a report you can't edit, so these splits can't be changed.")).toBeTruthy();
        });

        it('saves as before when the user can edit every split', async () => {
            // Given the regular approver, who also manages the open report of the rejected split
            await setUpSplitGroup(CURRENT_USER_ACCOUNT_ID);

            // When the approver saves changed splits
            renderPage(MANAGED_REPORT_ID);
            await waitForBatchedUpdatesWithAct();
            fireEvent.press(screen.getByText('Save'));
            await waitForBatchedUpdatesWithAct();

            // Then the save goes through as today
            expect(updateSplitTransactionsFromSplitExpensesFlow).toHaveBeenCalledTimes(1);
        });
    });
});
