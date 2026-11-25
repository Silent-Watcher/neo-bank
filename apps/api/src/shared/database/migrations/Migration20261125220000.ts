import { Migration } from '@mikro-orm/migrations';

export class Migration20261125220000 extends Migration {
  override name = 'Migration20261125220000';

  override up(): void | Promise<void> {
    // Argon2id PHC strings are ~98 chars; raise the CHECK from 72 (bcrypt)
    // to 255 to fit them with margin (ADR-043). No data migration — the
    // project has no existing password hashes.
    this.addSql(`alter table "enrollments" drop constraint "enrollments_password_hash_length";`);
    this.addSql(
      `alter table "enrollments" add constraint "enrollments_password_hash_length" check (char_length(password_hash) <= 255);`,
    );
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "enrollments" drop constraint "enrollments_password_hash_length";`);
    this.addSql(
      `alter table "enrollments" add constraint "enrollments_password_hash_length" check (char_length(password_hash) <= 72);`,
    );
  }
}
