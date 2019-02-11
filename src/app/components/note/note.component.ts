import { Component, OnInit, ViewEncapsulation, HostListener } from '@angular/core';
import log from 'electron-log';
import { CollectionService } from '../../services/collection.service';
import * as Quill from 'quill';
import { ActivatedRoute } from '@angular/router';
import { Note } from '../../data/entities/note';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged } from "rxjs/internal/operators";
import { SnackBarService } from '../../services/snackBar.service';
import { TranslateService } from '@ngx-translate/core';
import { ErrorDialogComponent } from '../dialogs/errorDialog/errorDialog.component';
import { MatDialog } from '@angular/material';
import { remote, BrowserWindow } from 'electron';
import { RenameNoteResult } from '../../services/renameNoteResult';
import { GetNoteContentResult } from '../../services/getNoteContentResult';
import { Operation } from '../../core/enums';

@Component({
    selector: 'note-content',
    templateUrl: './note.component.html',
    styleUrls: ['./note.component.scss'],
    encapsulation: ViewEncapsulation.None
})
export class NoteComponent implements OnInit {
    constructor(private collectionService: CollectionService, private activatedRoute: ActivatedRoute,
        private snackBarService: SnackBarService, private translateService: TranslateService,
        private dialog: MatDialog) {
    }

    public noteTitleChanged: Subject<string> = new Subject<string>();
    public noteTextChanged: Subject<string> = new Subject<string>();
    public saveChangedAndCloseNoteWindow: Subject<string> = new Subject<string>();
    private isTitleChanged: boolean = false;
    private isContentChanged: boolean = false;

    private noteId: string;
    private originalNoteTitle: string;
    public noteTitle: string;
    private saveTimeoutMilliseconds: number = 5000;
    private windowCloseTimeoutMilliseconds: number = 500;

    private quill: Quill;

    // ngOndestroy doesn't tell us when a note window is closed, so we use this event instead.
    @HostListener('window:beforeunload', ['$event'])
    beforeunloadHandler(event) {
        log.info(`Detected closing of note with id=${this.noteId}`);

        // Prevents closing of the window
        if (this.isTitleChanged || this.isContentChanged) {
            this.isTitleChanged = false;
            this.isContentChanged = false;

            log.info(`Note with id=${this.noteId} is dirty. Preventing close to save changes first.`);
            event.preventDefault();
            event.returnValue = '';

            this.saveChangedAndCloseNoteWindow.next("");
        } else {
            log.info(`Note with id=${this.noteId} is clean. Closing directly.`);
            this.collectionService.setNoteIsOpen(this.noteId, false);
        }
    }

    async ngOnInit() {
        this.collectionService.initializeDataStoreAsync();

        let notePlaceHolder: string = await this.translateService.get('Notes.NotePlaceholder').toPromise();

        this.quill = new Quill('#editor', {
            placeholder: notePlaceHolder,
            theme: 'snow',
        });

        this.quill.on('text-change', () => {
            this.isContentChanged = true;
            this.noteTextChanged.next("");
        });

        // Get note id from url
        this.activatedRoute.queryParams.subscribe(async (params) => {
            let noteId: string = params['id'];

            // Get the note from the data store
            let note: Note = this.collectionService.getNote(noteId);
            log.info(`Opening note with id=${note.id}`);
            this.collectionService.setNoteIsOpen(note.id, true);

            this.noteId = note.id;
            this.originalNoteTitle = note.title;
            this.noteTitle = note.title;

            await this.getNoteContentAsync();
        });

        this.noteTitleChanged
            .pipe(debounceTime(this.saveTimeoutMilliseconds))
            .subscribe(async (newNoteTitle) => {
                await this.saveNoteTitleAsync(newNoteTitle);
            });

        this.noteTextChanged
            .pipe(debounceTime(this.saveTimeoutMilliseconds))
            .subscribe(async (_) => {
                await this.saveNoteContentAsync();
            });

        this.saveChangedAndCloseNoteWindow
            .pipe(debounceTime(this.windowCloseTimeoutMilliseconds))
            .subscribe((_) => {
                log.info(`Closing note with id=${this.noteId} after saving changes.`);
                this.collectionService.setNoteIsOpen(this.noteId, false);
                this.saveNoteAll();

                let window: BrowserWindow = remote.getCurrentWindow();
                window.close();
            });
    }

    public onNotetitleChange(newNoteTitle: string) {
        this.isTitleChanged = true;
        this.noteTitleChanged.next(newNoteTitle);
    }

    public performAction(): void {

    }

    private async saveNoteTitleAsync(newNoteTitle: string): Promise<void> {
        let renameNoteResult: RenameNoteResult = this.collectionService.renameNote(this.noteId, this.originalNoteTitle, newNoteTitle);

        if (renameNoteResult.operation === Operation.Blank) {
            this.noteTitle = this.originalNoteTitle;
            this.snackBarService.noteTitleCannotBeEmptyAsync();
        } else if (renameNoteResult.operation === Operation.Error) {
            this.noteTitle = this.originalNoteTitle;
            let generatedErrorText: string = (await this.translateService.get('ErrorTexts.RenameNoteError', { noteTitle: this.originalNoteTitle }).toPromise());

            this.dialog.open(ErrorDialogComponent, {
                width: '450px', data: { errorText: generatedErrorText }
            });
        } else if (renameNoteResult.operation === Operation.Success) {
            this.originalNoteTitle = renameNoteResult.newNoteTitle;
            this.noteTitle = renameNoteResult.newNoteTitle;
        } else {
            // Do nothing
        }
    }

    private async saveNoteContentAsync(): Promise<void> {
        // let html: string = this.quill.container.firstChild.innerHTML;
        let textContent: string = this.quill.getText();
        let jsonContent: string = JSON.stringify(this.quill.getContents());

        let operation: Operation = this.collectionService.updateNoteContent(this.noteId, textContent, jsonContent);

        if (operation === Operation.Error) {
            let generatedErrorText: string = (await this.translateService.get('ErrorTexts.UpdateNoteContentError').toPromise());

            this.dialog.open(ErrorDialogComponent, {
                width: '450px', data: { errorText: generatedErrorText }
            });
        } else {
            // Do nothing
        }
    }

    private saveNoteAll(): void {
        let textContent: string = this.quill.getText();
        let jsonContent: string = JSON.stringify(this.quill.getContents());
        this.collectionService.updateNote(this.noteId, this.noteTitle, textContent, jsonContent);
    }

    private async getNoteContentAsync(): Promise<void> {
        let getNoteContentResult: GetNoteContentResult = this.collectionService.getNoteContent(this.noteId);

        if (getNoteContentResult.operation === Operation.Error) {
            let generatedErrorText: string = (await this.translateService.get('ErrorTexts.GetNoteContentError').toPromise());

            this.dialog.open(ErrorDialogComponent, {
                width: '450px', data: { errorText: generatedErrorText }
            });
        } else {
            if (getNoteContentResult.noteContent) {
                // We can only parse to json if there is content
                this.quill.setContents(JSON.parse(getNoteContentResult.noteContent), 'silent');
            }
        }
    }
}
