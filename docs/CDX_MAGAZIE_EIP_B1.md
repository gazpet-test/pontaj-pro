# Magazie EIP B1 r4

Cele patru fisiere au fost create integral din r3 furnizat in brief; nu existau in worktree.

Migrarea si rollback-ul nu mai au BEGIN/COMMIT proprii. Primul element SQL este
garda de livrare/revenire: postgres, marcaj exact legat de txid, READ COMMITTED
si advisory lock comun runnerului. Migrarea refuza si reaplicarea.
Ordinea instructiunilor existente, functiile de business, tabelele, maparea,
UM, ACL/RLS si verificarile de istoric/invariant au fost pastrate.

Harness-ul reproduce tranzactia runnerului cu marcaje locale set_config.
Numai in copia izolata public/auth devin teste, iar conditia
`current_user <> 'postgres'` devine textual `current_user <> current_user`
pentru proprietarul nesuperuser eip_owner. Fisierele SQL livrate cer postgres.
Probele de refuz folosesc sesiuni separate cu ON_ERROR_STOP; inchiderea este
asteptata inainte de verificarea absentei efectelor. Probele existente pentru
rollback verifica acum fisierul complet, armat, in tranzactia runnerului.

Au fost pastrate cele 28 de scenarii existente si adaugate 5 probe r4:
ambalare statica (inclusiv probe negative ale scannerului), migrare nearmata,
nume/txid gresit si izolare gresita, reaplicare, rollback nearmat fara stergeri.
Scannerul local nu inlocuieste validatorul oficial de livrare.

Verificat local: cele patru fisiere sunt ASCII, exista 33 de probe declarate.
In V8 am executat proba statica r4 cu probele negative si am verificat
generarea tranzactiilor; parsarea JS a trecut dupa eliminarea importurilor
si substituirea import.meta.url numai in textul de verificare, fara executia
harness-ului. Aceasta verificare nu valideaza SQL pe server.

Nu am rulat Node, psql, cele 33 de probe pe PG17 sau validatorul oficial.
Nu am aplicat nimic pe BD; fara Git, credentiale sau deploy.
