/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import URI from 'vs/base/common/uri';
import {IModelContentChangedEvent2, IPosition, IRange} from 'vs/editor/common/editorCommon';
import {PrefixSumComputer} from 'vs/editor/common/viewModel/prefixSumComputer';

export class MirrorModel2 {

	protected _uri: URI;
	protected _lines: string[];
	protected _eol: string;
	protected _versionId: number;
	protected _lineStarts: PrefixSumComputer;

	constructor(uri: URI, lines: string[], eol: string, versionId: number) {
		this._uri = uri;
		this._lines = lines;
		this._eol = eol;
		this._versionId = versionId;
	}

	dispose(): void {
		this._lines.length = 0;
	}

	get version(): number {
		return this._versionId;
	}

	getText(): string {
		return this._lines.join(this._eol);
	}

	onEvents(events: IModelContentChangedEvent2[]): void {
		let newEOL: string = null;
		for (let i = 0, len = events.length; i < len; i++) {
			let e = events[i];
			if (e.eol) {
				newEOL = e.eol;
			}
		}
		if (newEOL && newEOL !== this._eol) {
			this._eol = newEOL;
			this._lineStarts = null;
		}

		// Update my lines
		let lastVersionId = -1;
		for (let i = 0, len = events.length; i < len; i++) {
			let e = events[i];

			this._acceptDeleteRange(e.range);
			this._acceptInsertText({
				lineNumber: e.range.startLineNumber,
				column: e.range.startColumn
			}, e.text);
			lastVersionId = Math.max(lastVersionId, e.versionId);
		}
		if (lastVersionId !== -1) {
			this._versionId = lastVersionId;
		}
	}

	protected _ensureLineStarts(): void {
		if (!this._lineStarts) {
			const lineStartValues:number[] = [];
			const eolLength = this._eol.length;
			for (let i = 0, len = this._lines.length; i < len; i++) {
				lineStartValues.push(this._lines[i].length + eolLength);
			}
			this._lineStarts = new PrefixSumComputer(lineStartValues);
		}
	}

	/**
	 * All changes to a line's text go through this method
	 */
	private _setLineText(lineIndex:number, newValue:string): void {
		this._lines[lineIndex] = newValue;
		if (this._lineStarts) {
			// update prefix sum
			this._lineStarts.changeValue(lineIndex, this._lines[lineIndex].length + this._eol.length);
		}
	}

	private _acceptDeleteRange(range: IRange): void {

		if (range.startLineNumber === range.endLineNumber) {
			if (range.startColumn === range.endColumn) {
				// Nothing to delete
				return;
			}
			// Delete text on the affected line
			this._setLineText(range.startLineNumber - 1,
				this._lines[range.startLineNumber - 1].substring(0, range.startColumn - 1)
				+ this._lines[range.startLineNumber - 1].substring(range.endColumn - 1)
			);
			return;
		}

		// Take remaining text on last line and append it to remaining text on first line
		this._setLineText(range.startLineNumber - 1,
			this._lines[range.startLineNumber - 1].substring(0, range.startColumn - 1)
			+ this._lines[range.endLineNumber - 1].substring(range.endColumn - 1)
		);

		// Delete middle lines
		this._lines.splice(range.startLineNumber, range.endLineNumber - range.startLineNumber);
		if (this._lineStarts) {
			// update prefix sum
			this._lineStarts.removeValues(range.startLineNumber, range.endLineNumber - range.startLineNumber);
		}
	}

	private _acceptInsertText(position: IPosition, insertText:string): void {
		if (insertText.length === 0) {
			// Nothing to insert
			return;
		}
		let insertLines = insertText.split(/\r\n|\r|\n/);
		if (insertLines.length === 1) {
			// Inserting text on one line
			this._setLineText(position.lineNumber - 1,
				this._lines[position.lineNumber - 1].substring(0, position.column - 1)
				+ insertLines[0]
				+ this._lines[position.lineNumber - 1].substring(position.column - 1)
			);
			return;
		}

		// Append overflowing text from first line to the end of text to insert
		insertLines[insertLines.length - 1] += this._lines[position.lineNumber - 1].substring(position.column - 1);

		// Delete overflowing text from first line and insert text on first line
		this._setLineText(position.lineNumber - 1,
			this._lines[position.lineNumber - 1].substring(0, position.column - 1)
			+ insertLines[0]
		);

		// Insert new lines & store lengths
		let newLengths:number[] = new Array<number>(insertLines.length - 1);
		for (let i = 1; i < insertLines.length; i++) {
			this._lines.splice(position.lineNumber + i - 1, 0, insertLines[i]);
			newLengths[i - 1] = insertLines[i].length + this._eol.length;
		}

		if (this._lineStarts) {
			// update prefix sum
			this._lineStarts.insertValues(position.lineNumber, newLengths);
		}
	}
}
