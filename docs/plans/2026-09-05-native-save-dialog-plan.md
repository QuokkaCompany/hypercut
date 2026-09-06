# Actual Mac replacement confirmation dialogs

Complete the OS-dialog portion of E04. `dialog.showSaveDialog` selects the destination before atomic replacement; earlier substituted return paths did not establish native confirmation behavior.

Launch the package with test-only application data and generated media/projects. Do not replace the save dialog or its response. Only initial media selection is supplied by the test, then the original function is restored. Operate actual save/replacement dialogs through accessibility tools and inspect the selected name onscreen.

1. Save over an existing project, cancel replacement, then close the save dialog. Verify unchanged bytes/hash, dirty state, and retry availability.
2. Retry and approve replacement. Verify a complete current v7 project and cleared dirty state.
3. Save the edited MP4 over an existing MP4 and cancel. Preserve both existing MP4 and source.
4. Retry and approve. Saved bytes must match the generated output and fully decode.
5. Select the generated source as export destination and approve the OS prompt. The app must reject that destination and preserve the source.

Preserve observed dialog actions and hashes. Do not use private documents or existing user videos. Power failure and browser download collisions remain separate.
