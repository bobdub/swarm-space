# Settings maintenance

- StorageTargetsPanel accepts an after-browser content slot so cleanup actions follow browser capacity without duplicating provider state.
- Test Connect (Account tab) shares the mesh peer ID, so it pauses the mesh without persisting that preference, resumes it on stop, and compares reached peers against the pre-test mesh snapshot.
