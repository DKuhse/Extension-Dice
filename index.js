import { animation_duration } from '../../../../script.js';
import { renderExtensionTemplateAsync } from '../../../extensions.js';
import { POPUP_RESULT, POPUP_TYPE, callGenericPopup } from '../../../popup.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import { ARGUMENT_TYPE, SlashCommandArgument, SlashCommandNamedArgument } from '../../../slash-commands/SlashCommandArgument.js';
import { commonEnumProviders } from '../../../slash-commands/SlashCommandCommonEnumsProvider.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { isTrueBoolean } from '../../../utils.js';
export { MODULE_NAME };

const MODULE_NAME = 'dice';
const TEMPLATE_PATH = 'third-party/Extension-Dice';
const TOOL_NAME = 'RollTheDice';
const EDIT_METADATA_KEY = 'dice_roll_edits';

// Define default settings
const defaultSettings = Object.freeze({
    functionTool: false,
});

// Define a function to get or initialize settings
function getSettings() {
    const { extensionSettings } = SillyTavern.getContext();

    // Initialize settings if they don't exist
    if (!extensionSettings[MODULE_NAME]) {
        extensionSettings[MODULE_NAME] = structuredClone(defaultSettings);
    }

    // Ensure all default keys exist (helpful after updates)
    for (const key of Object.keys(defaultSettings)) {
        if (!Object.hasOwn(extensionSettings[MODULE_NAME], key)) {
            extensionSettings[MODULE_NAME][key] = defaultSettings[key];
        }
    }

    return extensionSettings[MODULE_NAME];
}

/**
 * Roll the dice.
 * @param {string} customDiceFormula Dice formula
 * @param {boolean} quiet Suppress chat output
 * @returns {Promise<{total: string, rolls: Array<string>}>} Roll result
 */
async function doDiceRoll(customDiceFormula, quiet = false) {
    const nullValue = { total: '', rolls: [] };

    let value = typeof customDiceFormula === 'string' ? customDiceFormula.trim() : $(this).data('value');

    if (value == 'custom') {
        value = await callGenericPopup('Enter the dice formula:<br><i>(for example, <tt>2d6</tt>)</i>', POPUP_TYPE.INPUT, '', { okButton: 'Roll', cancelButton: 'Cancel' });
    }

    if (!value) {
        return nullValue;
    }

    const isValid = SillyTavern.libs.droll.validate(value);

    if (isValid) {
        const result = SillyTavern.libs.droll.roll(value);
        if (!result) {
            return nullValue;
        }
        if (!quiet) {
            const context = SillyTavern.getContext();
            context.sendSystemMessage('generic', `${context.name1} rolls a ${value}. The result is: ${result.total} (${result.rolls.join(', ')})`, { isSmallSys: true });
        }
        return { total: String(result.total), rolls: result.rolls.map(String) };
    } else {
        toastr.warning('Invalid dice formula');
        return nullValue;
    }
}

/**
 * Format a dice function tool result.
 * @param {object} args Function tool arguments
 * @param {{total: string, rolls: Array<string>}} roll Roll result
 * @returns {string} Formatted tool result
 */
function formatDiceToolResult(args, roll) {
    return args.who
        ? `${args.who} rolls a ${args.formula}. The result is: ${roll.total}. Individual rolls: ${roll.rolls.join(', ')}`
        : `The result of a ${args.formula} roll is: ${roll.total}. Individual rolls: ${roll.rolls.join(', ')}`;
}

/**
 * Parse a JSON object, returning null on failure.
 * @param {unknown} value Value to parse
 * @returns {object|null} Parsed object
 */
function parseJsonObject(value) {
    try {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

/**
 * Parse and validate a supported dice formula.
 * @param {string} formula Dice formula
 * @returns {object|null} Parsed formula
 */
function parseDiceFormula(formula) {
    const parsed = SillyTavern.libs.droll.parse(formula);
    if (!parsed
        || !Number.isSafeInteger(parsed.numDice)
        || !Number.isSafeInteger(parsed.numSides)
        || !Number.isSafeInteger(parsed.modifier)
        || !Number.isSafeInteger(parsed.minResult)
        || !Number.isSafeInteger(parsed.maxResult)) {
        return null;
    }

    return parsed.numDice > 0 && parsed.numSides > 0 ? parsed : null;
}

/**
 * Validate individual dice values against a formula.
 * @param {object} formula Parsed formula
 * @param {Array<number>} rolls Individual dice values
 * @returns {{error: string|null, total: number|null}} Validation result
 */
function validateRollValues(formula, rolls) {
    if (rolls.length !== formula.numDice) {
        return { error: `Expected ${formula.numDice} individual roll${formula.numDice === 1 ? '' : 's'}.`, total: null };
    }

    for (const [index, value] of rolls.entries()) {
        if (!Number.isSafeInteger(value) || value < 1 || value > formula.numSides) {
            return { error: `Die ${index + 1} must be an integer from 1 to ${formula.numSides}.`, total: null };
        }
    }

    const total = rolls.reduce((sum, value) => sum + value, formula.modifier);
    if (!Number.isSafeInteger(total)) {
        return { error: 'The calculated total is outside the supported integer range.', total: null };
    }

    return { error: null, total };
}

/**
 * Read a dice roll from a stored tool invocation.
 * @param {object} invocation Tool invocation
 * @returns {{args: object, formula: string, parsedFormula: object, rolls: Array<number>, total: number}|null} Parsed roll
 */
function parseStoredDiceRoll(invocation) {
    if (invocation?.name !== TOOL_NAME) {
        return null;
    }

    const args = parseJsonObject(invocation.parameters);
    const formula = typeof args?.formula === 'string' ? args.formula.trim() : '';
    const parsedFormula = parseDiceFormula(formula);
    const rollsMatch = typeof invocation.result === 'string'
        ? invocation.result.match(/Individual rolls:\s*([+-]?\d+(?:\s*,\s*[+-]?\d+)*)\s*$/i)
        : null;

    if (!args || !parsedFormula || !rollsMatch) {
        return null;
    }

    const rolls = rollsMatch[1].split(',').map(value => Number(value.trim()));
    const validation = validateRollValues(parsedFormula, rolls);
    if (validation.error || validation.total === null) {
        return null;
    }

    return { args, formula, parsedFormula, rolls, total: validation.total };
}

/**
 * Get the persistent edit key for an invocation.
 * @param {object} invocation Tool invocation
 * @param {number} invocationIndex Tool invocation index
 * @returns {string} Persistent edit key
 */
function getEditKey(invocation, invocationIndex) {
    return invocation?.id ? `id:${invocation.id}` : `index:${invocationIndex}`;
}

/**
 * Parse JSON when possible for the tool call's visible representation.
 * @param {unknown} value Value to parse
 * @returns {unknown} Parsed or original value
 */
function tryParseJson(value) {
    if (typeof value !== 'string') {
        return value;
    }

    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}

/**
 * Group tool names for the tool call message summary.
 * @param {Array<string>} toolNames Tool display names
 * @returns {string} Grouped names
 */
function groupToolNames(toolNames) {
    const counts = toolNames.reduce((result, name) => {
        result[name] = (result[name] || 0) + 1;
        return result;
    }, {});
    return Object.entries(counts).map(([name, count]) => count > 1 ? `${name} (${count})` : name).join(', ');
}

/**
 * Rebuild the persisted, visible representation of a tool call message.
 * @param {Array<object>} invocations Tool invocations
 * @returns {string} Tool call message HTML
 */
function formatToolInvocationMessage(invocations) {
    const data = structuredClone(invocations);
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    const pre = document.createElement('pre');
    const code = document.createElement('code');

    code.classList.add('language-json');
    data.forEach(invocation => {
        invocation.parameters = tryParseJson(invocation.parameters);
        invocation.result = tryParseJson(invocation.result);
    });
    code.textContent = JSON.stringify(data, null, 2);
    summary.textContent = `Tool calls: ${groupToolNames(data.map(invocation => invocation.displayName || invocation.name))}`;
    pre.append(code);
    details.append(summary, pre);
    return details.outerHTML;
}

/**
 * Get an invocation and its containing message by chat indexes.
 * @param {number} messageId Chat message index
 * @param {number} invocationIndex Tool invocation index
 * @returns {{context: object, message: object, invocation: object}|null} Located invocation
 */
function getInvocation(messageId, invocationIndex) {
    const context = SillyTavern.getContext();
    const message = context.chat?.[messageId];
    const invocation = message?.extra?.tool_invocations?.[invocationIndex];
    if (!message || invocation?.name !== TOOL_NAME) {
        return null;
    }

    return { context, message, invocation };
}

/**
 * Set the editor's validation message.
 * @param {JQuery<HTMLElement>} editor Editor element
 * @param {string} error Error message
 */
function setEditorError(editor, error) {
    editor.find('.dice-roll-error').text(error).toggle(!!error);
}

/**
 * Read current dice values from the editor.
 * @param {JQuery<HTMLElement>} editor Editor element
 * @returns {Array<number>} Dice values
 */
function getEditorRolls(editor) {
    return editor.find('.dice-roll-value').map(function () {
        return this.value === '' ? Number.NaN : Number(this.value);
    }).get();
}

/**
 * Validate and read the current editor state.
 * @param {JQuery<HTMLElement>} editor Editor element
 * @returns {{error: string|null, formula?: string, parsedFormula?: object, rolls?: Array<number>, total?: number}} Editor state
 */
function getEditorState(editor) {
    const formula = String(editor.find('.dice-roll-formula').val() || '').trim();
    const parsedFormula = parseDiceFormula(formula);
    if (!parsedFormula) {
        return { error: 'Enter a valid dice formula, such as 2d6+1.' };
    }

    const rolls = getEditorRolls(editor);
    const validation = validateRollValues(parsedFormula, rolls);
    if (validation.error || validation.total === null) {
        return { error: validation.error || 'Invalid dice values.' };
    }

    return { error: null, formula, parsedFormula, rolls, total: validation.total };
}

/**
 * Refresh the calculated values and validation state in an editor.
 * @param {JQuery<HTMLElement>} editor Editor element
 */
function refreshEditorSummary(editor) {
    const state = getEditorState(editor);
    setEditorError(editor, state.error || '');
    editor.find('.dice-roll-modifier').text(state.parsedFormula ? String(state.parsedFormula.modifier) : '—');
    editor.find('.dice-roll-total').text(state.total === undefined ? '—' : String(state.total));
}

/**
 * Render individual die inputs for the current formula.
 * @param {JQuery<HTMLElement>} editor Editor element
 * @param {Array<number|string>} previousRolls Values to preserve when valid
 */
function renderRollInputs(editor, previousRolls) {
    if (previousRolls.length > 0) {
        editor.data('rollValues', previousRolls);
    }

    const preservedRolls = editor.data('rollValues') || [];
    const formula = String(editor.find('.dice-roll-formula').val() || '').trim();
    const parsedFormula = parseDiceFormula(formula);
    const container = editor.find('.dice-roll-values').empty();

    if (!parsedFormula) {
        refreshEditorSummary(editor);
        return;
    }

    for (let index = 0; index < parsedFormula.numDice; index++) {
        const previousValue = Number(preservedRolls[index]);
        const value = Number.isSafeInteger(previousValue) && previousValue >= 1 && previousValue <= parsedFormula.numSides
            ? String(previousValue)
            : '';
        const label = $('<label class="dice-roll-value-row"></label>');
        const caption = $('<span></span>').text(`Die ${index + 1} (d${parsedFormula.numSides})`);
        const input = $('<input class="text_pole dice-roll-value" type="number" step="1">')
            .attr({ min: 1, max: parsedFormula.numSides })
            .val(value);
        label.append(caption, input);
        container.append(label);
    }

    refreshEditorSummary(editor);
}

/**
 * Persist and rerender a changed tool call message.
 * @param {object} context SillyTavern context
 * @param {number} messageId Chat message index
 * @param {object} message Chat message
 */
async function commitToolMessageChange(context, messageId, message) {
    message.mes = formatToolInvocationMessage(message.extra.tool_invocations);
    await context.eventSource.emit(context.eventTypes.MESSAGE_EDITED, messageId);
    context.updateMessageBlock(messageId, message);
    await context.eventSource.emit(context.eventTypes.MESSAGE_UPDATED, messageId);
    await context.saveChat();
    decorateDiceToolMessages();
}

/**
 * Edit a stored dice tool invocation.
 * @param {number} messageId Chat message index
 * @param {number} invocationIndex Tool invocation index
 */
async function editDiceInvocation(messageId, invocationIndex) {
    if (document.body.dataset.generating === 'true') {
        toastr.warning('Wait for generation to finish before editing a dice roll.');
        return;
    }

    const located = getInvocation(messageId, invocationIndex);
    const storedRoll = located && parseStoredDiceRoll(located.invocation);
    if (!located || !storedRoll) {
        toastr.error('This dice roll could not be parsed safely and was not changed.');
        return;
    }

    const editor = $(await renderExtensionTemplateAsync(TEMPLATE_PATH, 'editor'));
    editor.find('.dice-roll-who').text(storedRoll.args.who || 'Unspecified');
    editor.find('.dice-roll-formula').val(storedRoll.formula);
    renderRollInputs(editor, storedRoll.rolls);

    editor.on('input', '.dice-roll-formula', function () {
        renderRollInputs(editor, getEditorRolls(editor));
    });
    editor.on('input', '.dice-roll-value', function () {
        editor.data('rollValues', getEditorRolls(editor));
        refreshEditorSummary(editor);
    });

    let editedState = null;
    const popupResult = await callGenericPopup(editor, POPUP_TYPE.CONFIRM, '', {
        okButton: 'Save Roll',
        cancelButton: 'Cancel',
        wide: true,
        allowVerticalScrolling: true,
        onClosing: popup => {
            if (popup.result !== POPUP_RESULT.AFFIRMATIVE) {
                return true;
            }

            const state = getEditorState(editor);
            if (state.error) {
                setEditorError(editor, state.error);
                return false;
            }

            editedState = state;
            return true;
        },
    });

    if (popupResult !== POPUP_RESULT.AFFIRMATIVE || !editedState) {
        return;
    }

    const isUnchanged = editedState.formula === storedRoll.formula
        && editedState.rolls.length === storedRoll.rolls.length
        && editedState.rolls.every((value, index) => value === storedRoll.rolls[index]);
    if (isUnchanged) {
        toastr.info('The dice roll was not changed.');
        return;
    }

    const current = getInvocation(messageId, invocationIndex);
    if (!current) {
        toastr.error('The dice roll is no longer available.');
        return;
    }

    current.message.extra[EDIT_METADATA_KEY] ??= {};
    const editKey = getEditKey(current.invocation, invocationIndex);
    current.message.extra[EDIT_METADATA_KEY][editKey] ??= {
        original: {
            parameters: current.invocation.parameters,
            result: current.invocation.result,
            signature: current.invocation.signature ?? null,
            reasoning: current.invocation.reasoning ?? null,
        },
        editedAt: new Date().toISOString(),
    };
    current.message.extra[EDIT_METADATA_KEY][editKey].editedAt = new Date().toISOString();

    const args = parseJsonObject(current.invocation.parameters) || {};
    const formulaChanged = args.formula !== editedState.formula;
    args.formula = editedState.formula;
    current.invocation.parameters = JSON.stringify(args);
    current.invocation.result = formatDiceToolResult(args, {
        total: String(editedState.total),
        rolls: editedState.rolls.map(String),
    });
    if (formulaChanged) {
        current.invocation.signature = null;
    }

    await commitToolMessageChange(current.context, messageId, current.message);
    toastr.success('Dice roll updated.');
}

/**
 * Restore an edited dice tool invocation.
 * @param {number} messageId Chat message index
 * @param {number} invocationIndex Tool invocation index
 */
async function restoreDiceInvocation(messageId, invocationIndex) {
    if (document.body.dataset.generating === 'true') {
        toastr.warning('Wait for generation to finish before restoring a dice roll.');
        return;
    }

    const located = getInvocation(messageId, invocationIndex);
    if (!located) {
        toastr.error('The dice roll is no longer available.');
        return;
    }

    const editKey = getEditKey(located.invocation, invocationIndex);
    const editRecord = located.message.extra?.[EDIT_METADATA_KEY]?.[editKey];
    if (!editRecord?.original) {
        toastr.info('This dice roll has no original value to restore.');
        return;
    }

    located.invocation.parameters = editRecord.original.parameters;
    located.invocation.result = editRecord.original.result;
    located.invocation.signature = editRecord.original.signature;
    located.invocation.reasoning = editRecord.original.reasoning;
    delete located.message.extra[EDIT_METADATA_KEY][editKey];
    if (Object.keys(located.message.extra[EDIT_METADATA_KEY]).length === 0) {
        delete located.message.extra[EDIT_METADATA_KEY];
    }

    await commitToolMessageChange(located.context, messageId, located.message);
    toastr.success('Original dice roll restored.');
}

/**
 * Add dice-specific actions to visible tool call messages.
 */
function decorateDiceToolMessages() {
    const context = SillyTavern.getContext();
    $('#chat .mes').each(function () {
        const messageElement = $(this);
        const messageId = Number(messageElement.attr('mesid'));
        const message = context.chat?.[messageId];
        const invocations = message?.extra?.tool_invocations;
        const summary = messageElement.find('.mes_text details > summary').first();

        messageElement.find('.dice-roll-actions').remove();
        if (!Array.isArray(invocations) || !summary.length) {
            return;
        }

        const diceInvocations = invocations
            .map((invocation, index) => ({ invocation, index }))
            .filter(({ invocation }) => invocation?.name === TOOL_NAME);
        if (diceInvocations.length === 0) {
            return;
        }

        const actions = $('<span class="dice-roll-actions"></span>');
        for (const { invocation, index } of diceInvocations) {
            const args = parseJsonObject(invocation.parameters);
            const source = args?.who || `Roll ${index + 1}`;
            const editKey = getEditKey(invocation, index);
            const editRecord = message.extra?.[EDIT_METADATA_KEY]?.[editKey];
            const group = $('<span class="dice-roll-action-group"></span>');
            const sourceLabel = $('<span class="dice-roll-source"></span>').text(source);
            const editButton = $('<button type="button" class="menu_button dice-roll-edit fa-solid fa-pencil"></button>')
                .attr({
                    'aria-label': `Edit dice roll for ${source}`,
                    'title': `Edit dice roll for ${source}`,
                    'data-message-id': messageId,
                    'data-invocation-index': index,
                });
            group.append(sourceLabel, editButton);

            if (editRecord) {
                const badge = $('<span class="dice-roll-edited-badge">edited</span>')
                    .attr('title', `Manually edited ${editRecord.editedAt || ''}`.trim());
                const restoreButton = $('<button type="button" class="menu_button dice-roll-restore fa-solid fa-rotate-left"></button>')
                    .attr({
                        'aria-label': `Restore original dice roll for ${source}`,
                        'title': `Restore original dice roll for ${source}`,
                        'data-message-id': messageId,
                        'data-invocation-index': index,
                    });
                group.append(badge, restoreButton);
            }

            actions.append(group);
        }

        summary.append(actions);
    });
}

function scheduleDiceToolDecoration() {
    requestAnimationFrame(decorateDiceToolMessages);
}

/**
 * Repair reasoning/signatures cleared by the initial editable-roll implementation.
 * @returns {Promise<void>}
 */
async function repairLegacyEditedDiceMetadata() {
    const context = SillyTavern.getContext();
    const changedMessages = [];

    context.chat.forEach((message, messageId) => {
        const invocations = message?.extra?.tool_invocations;
        const editRecords = message?.extra?.[EDIT_METADATA_KEY];
        if (!Array.isArray(invocations) || !editRecords) {
            return;
        }

        let messageChanged = false;
        invocations.forEach((invocation, invocationIndex) => {
            if (invocation?.name !== TOOL_NAME) {
                return;
            }

            const editRecord = editRecords[getEditKey(invocation, invocationIndex)];
            if (!editRecord?.original) {
                return;
            }

            if (invocation.reasoning == null && editRecord.original.reasoning != null) {
                invocation.reasoning = editRecord.original.reasoning;
                messageChanged = true;
            }

            const currentArgs = parseJsonObject(invocation.parameters);
            const originalArgs = parseJsonObject(editRecord.original.parameters);
            const formulaUnchanged = currentArgs?.formula === originalArgs?.formula;
            if (formulaUnchanged && invocation.signature == null && editRecord.original.signature != null) {
                invocation.signature = editRecord.original.signature;
                messageChanged = true;
            }
        });

        if (messageChanged) {
            message.mes = formatToolInvocationMessage(invocations);
            changedMessages.push({ message, messageId });
        }
    });

    if (changedMessages.length === 0) {
        return;
    }

    for (const { message, messageId } of changedMessages) {
        context.updateMessageBlock(messageId, message);
        await context.eventSource.emit(context.eventTypes.MESSAGE_UPDATED, messageId);
    }
    await context.saveChat();
    decorateDiceToolMessages();
}

async function addDiceRollButton() {
    const buttonHtml = await renderExtensionTemplateAsync(TEMPLATE_PATH, 'button');
    const dropdownHtml = await renderExtensionTemplateAsync(TEMPLATE_PATH, 'dropdown');
    const settingsHtml = await renderExtensionTemplateAsync(TEMPLATE_PATH, 'settings');

    const getWandContainer = () => $(document.getElementById('dice_wand_container') ?? document.getElementById('extensionsMenu'));
    getWandContainer().append(buttonHtml);

    const getSettingsContainer = () => $(document.getElementById('dice_container') ?? document.getElementById('extensions_settings2'));
    getSettingsContainer().append(settingsHtml);

    const settings = getSettings();
    $('#dice_function_tool').prop('checked', settings.functionTool).on('change', function () {
        settings.functionTool = !!$(this).prop('checked');
        SillyTavern.getContext().saveSettingsDebounced();
        registerFunctionTools();
    });

    $(document.body).append(dropdownHtml);
    $('#dice_dropdown li').on('click', function () {
        dropdown.fadeOut(animation_duration);
        doDiceRoll($(this).data('value'), false);
    });
    const button = $('#roll_dice');
    const dropdown = $('#dice_dropdown');
    dropdown.hide();

    const popper = SillyTavern.libs.Popper.createPopper(button.get(0), dropdown.get(0), {
        placement: 'top',
    });

    $(document).on('click touchend', function (e) {
        const target = $(e.target);
        if (target.is(dropdown) || target.closest(dropdown).length) return;
        if (target.is(button) && !dropdown.is(':visible')) {
            e.preventDefault();

            dropdown.fadeIn(animation_duration);
            popper.update();
        } else {
            dropdown.fadeOut(animation_duration);
        }
    });
}

function registerFunctionTools() {
    try {
        const { registerFunctionTool, unregisterFunctionTool } = SillyTavern.getContext();
        if (!registerFunctionTool || !unregisterFunctionTool) {
            console.debug('Dice: function tools are not supported');
            return;
        }

        unregisterFunctionTool(TOOL_NAME);

        // Function tool is disabled by the settings
        const settings = getSettings();
        if (!settings.functionTool) {
            return;
        }

        const rollDiceSchema = Object.freeze({
            $schema: 'http://json-schema.org/draft-04/schema#',
            type: 'object',
            properties: {
                who: {
                    type: 'string',
                    description: 'The name of the persona rolling the dice',
                },
                formula: {
                    type: 'string',
                    description: 'A dice formula to roll, e.g. 2d6',
                },
            },
            required: [
                'who',
                'formula',
            ],
        });

        registerFunctionTool({
            name: TOOL_NAME,
            displayName: 'Dice Roll',
            description: 'Rolls the dice using the provided formula and returns the numeric result. Use when it is necessary to roll the dice to determine the outcome of an action or when the user requests it.',
            parameters: rollDiceSchema,
            action: async (args) => {
                if (!args?.formula) args = { ...args, formula: '1d6' };
                const roll = await doDiceRoll(args.formula, true);
                return formatDiceToolResult(args, roll);
            },
            formatMessage: () => '',
        });
    } catch (error) {
        console.error('Dice: Error registering function tools', error);
    }
}

jQuery(async function () {
    await addDiceRollButton();
    registerFunctionTools();

    const context = SillyTavern.getContext();
    const decorationEvents = [
        context.eventTypes.TOOL_CALLS_RENDERED,
        context.eventTypes.CHAT_CHANGED,
        context.eventTypes.CHAT_LOADED,
        context.eventTypes.MORE_MESSAGES_LOADED,
        context.eventTypes.MESSAGE_UPDATED,
    ];
    decorationEvents.forEach(event => context.eventSource.on(event, scheduleDiceToolDecoration));
    context.eventSource.on(context.eventTypes.CHAT_CHANGED, repairLegacyEditedDiceMetadata);

    $(document).on('click', '.dice-roll-edit', async function (event) {
        event.preventDefault();
        event.stopPropagation();
        await editDiceInvocation(Number(this.dataset.messageId), Number(this.dataset.invocationIndex));
    });
    $(document).on('click', '.dice-roll-restore', async function (event) {
        event.preventDefault();
        event.stopPropagation();
        await restoreDiceInvocation(Number(this.dataset.messageId), Number(this.dataset.invocationIndex));
    });
    await repairLegacyEditedDiceMetadata();
    scheduleDiceToolDecoration();

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'roll',
        aliases: ['r'],
        callback: async (args, value) => {
            const quiet = isTrueBoolean(String(args.quiet));
            const result = await doDiceRoll(String(value || '1d6'), quiet);
            return result.total;
        },
        helpString: 'Roll the dice.',
        returns: 'roll result',
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'quiet',
                description: 'Do not display the result in chat',
                isRequired: false,
                typeList: [ARGUMENT_TYPE.BOOLEAN],
                defaultValue: String(false),
                enumProvider: commonEnumProviders.boolean('trueFalse'),
            }),
        ],
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'dice formula, e.g. 2d6',
                isRequired: true,
                typeList: [ARGUMENT_TYPE.STRING],
            }),
        ],
    }));
});
